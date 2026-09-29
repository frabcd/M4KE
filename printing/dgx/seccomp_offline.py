"""Per-process kernel socket restrictions, not a complete filesystem sandbox.

Reference: https://docs.kernel.org/userspace-api/seccomp_filter.html
Only AF_UNIX sockets are allowed for the private X server. All Internet, packet,
netlink and other socket families plus io_uring creation are denied. Filters persist
across exec/fork, privileges cannot be gained, inherited descriptors are closed.
"""
import ctypes
import errno
import json
import os
import socket
import subprocess
import sys

class ArgCmp(ctypes.Structure):
    _fields_ = [("arg", ctypes.c_uint), ("op", ctypes.c_int), ("datum_a", ctypes.c_uint64), ("datum_b", ctypes.c_uint64)]

def restrict_network():
    libc = ctypes.CDLL(None, use_errno=True)
    sec = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    sec.seccomp_init.argtypes = [ctypes.c_uint32]
    sec.seccomp_init.restype = ctypes.c_void_p
    sec.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    sec.seccomp_syscall_resolve_name.restype = ctypes.c_int
    sec.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ctypes.POINTER(ArgCmp)]
    sec.seccomp_load.argtypes = [ctypes.c_void_p]
    sec.seccomp_release.argtypes = [ctypes.c_void_p]
    if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
        raise OSError(ctypes.get_errno(), "PR_SET_NO_NEW_PRIVS failed")
    context = sec.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW; libseccomp checks native architecture.
    if not context:
        raise RuntimeError("seccomp_init failed")
    try:
        deny = 0x00050000 | errno.EPERM
        for name in [b"socket", b"socketpair"]:
            number = sec.seccomp_syscall_resolve_name(name)
            compare = ArgCmp(0, 1, socket.AF_UNIX, 0)  # SCMP_CMP_NE
            if number < 0 or sec.seccomp_rule_add_array(context, deny, number, 1, ctypes.byref(compare)) != 0:
                raise RuntimeError("Required socket filter rejected")
        for name in [b"io_uring_setup", b"ptrace", b"pidfd_getfd", b"process_vm_writev"]:
            number = sec.seccomp_syscall_resolve_name(name)
            if number < 0 or sec.seccomp_rule_add_array(context, deny, number, 0, None) != 0:
                raise RuntimeError("Required syscall filter rejected: " + name.decode())
        if sec.seccomp_load(context) != 0:
            raise RuntimeError("Kernel refused seccomp filter")
    finally:
        sec.seccomp_release(context)

def run(args, **kwargs):
    return subprocess.run(args, close_fds=True, preexec_fn=restrict_network, **kwargs)

def selftest():
    baseline = []
    for family in [socket.AF_INET, socket.AF_INET6]:
        with socket.socket(family, socket.SOCK_STREAM):
            baseline.append({"family": int(family), "socketCreationAllowedBeforeFilter": True})
    restrict_network()
    checks = []
    for family in [socket.AF_INET, socket.AF_INET6, socket.AF_PACKET, socket.AF_NETLINK]:
        try:
            s = socket.socket(family, socket.SOCK_DGRAM)
            s.close()
            checks.append({"family": int(family), "denied": False})
        except OSError as exc:
            checks.append({"family": int(family), "denied": exc.errno == errno.EPERM, "errno": exc.errno})
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM):
        unix_allowed = True
    status = open("/proc/self/status").read()
    libc = ctypes.CDLL(None, use_errno=True)
    sec = ctypes.CDLL("libseccomp.so.2")
    sec.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    number = sec.seccomp_syscall_resolve_name(b"io_uring_setup")
    syscall_result = libc.syscall(number, 0, 0)
    io_uring_denied = syscall_result == -1 and ctypes.get_errno() == errno.EPERM
    result = {"beforeFilterControls": baseline, "networkSocketTests": checks, "unixSocketAllowed": unix_allowed, "ioUringSetupDenied": io_uring_denied,
              "noNewPrivileges": "NoNewPrivs:\t1" in status, "seccompFilterActive": "Seccomp:\t2" in status}
    result["pass"] = all(c["denied"] for c in checks) and unix_allowed and io_uring_denied and result["noNewPrivileges"] and result["seccompFilterActive"]
    print(json.dumps(result))
    return 0 if result["pass"] else 1

if __name__ == "__main__":
    raise SystemExit(selftest())
