"""Read an immutable job-local STEP snapshot by full SHA; preserve source origin."""
from pathlib import Path, PurePosixPath
import json,hashlib,re,math
from copy import deepcopy
SHA=re.compile(r'^[0-9a-f]{64}$')

def load_library_component(source_sha256, library_root=None, cache=None):
    import cadquery as cq
    from OCP.STEPCAFControl import STEPCAFControl_Reader
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.Interface import Interface_Static
    from OCP.TDocStd import TDocStd_Document
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.XCAFDoc import XCAFDoc_DocumentTool
    from OCP.TDF import TDF_LabelSequence
    from OCP.TColStd import TColStd_SequenceOfAsciiString
    if not isinstance(source_sha256,str) or not SHA.fullmatch(source_sha256):raise ValueError('Full source SHA256 required')
    root=Path(library_root or Path(__file__).resolve().parents[1]/'library')
    if root.is_symlink() or not root.is_dir():raise ValueError('Regular job library snapshot required')
    manifest_path=root/'manifest.json'
    if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size>1048576:raise ValueError('Invalid library snapshot manifest')
    raw=manifest_path.read_bytes();manifest=json.loads(raw);manifest_hash=hashlib.sha256(raw).hexdigest()
    if manifest.get('schema')!='m4ke-job-library-snapshot-1' or not isinstance(manifest.get('entries'),list) or len(manifest['entries'])>24:raise ValueError('Invalid library snapshot schema')
    matches=[e for e in manifest['entries'] if e.get('sourceSha256')==source_sha256]
    if len(matches)!=1:raise ValueError('Source absent or ambiguous in job snapshot')
    entry=matches[0]
    if entry.get('units')!='mm' or entry.get('frame')!='source-origin':raise ValueError('Library frame/units cannot be overridden')
    if entry.get('file')!='models/'+source_sha256+'.step':raise ValueError('Unsafe source path')
    path=root/entry['file']
    if path.parent.is_symlink() or path.is_symlink() or not path.is_file() or not 20<=path.stat().st_size<=16*1024*1024:raise ValueError('Invalid source file')
    if hashlib.sha256(path.read_bytes()).hexdigest()!=source_sha256:raise ValueError('Source hash mismatch')
    key=('library',str(path.resolve()),source_sha256,manifest_hash)
    if cache is not None and key in cache:
        shape,evidence=cache[key];return shape.copy(mesh=False),deepcopy(evidence)
    reader=STEPCAFControl_Reader();reader.SetColorMode(True);reader.SetNameMode(True)
    Interface_Static.SetCVal_s('xstep.cascade.unit','MM')
    if reader.ReadFile(str(path))!=IFSelect_RetDone:raise ValueError('STEP read failed')
    length,angle,solid=[TColStd_SequenceOfAsciiString() for _ in range(3)];reader.Reader().FileUnits(length,angle,solid)
    units=[length.Value(i).ToCString() for i in range(1,length.Length()+1)]
    if not units:raise ValueError('STEP length units unknown')
    doc=TDocStd_Document(TCollection_ExtendedString('BinXCAF'))
    if not reader.Transfer(doc):raise ValueError('STEP transfer failed')
    tool=XCAFDoc_DocumentTool.ShapeTool_s(doc.Main());labels=TDF_LabelSequence();tool.GetFreeShapes(labels)
    roots=[cq.Shape.cast(tool.GetShape_s(labels.Value(i))) for i in range(1,labels.Length()+1)]
    if not roots:raise ValueError('Empty STEP')
    compound=cq.Compound.makeCompound(roots);solids=compound.Solids()
    if not 1<=len(solids)<=3000 or not compound.isValid() or any(not s.isValid() or s.Volume()<=0 for s in solids):raise ValueError('Source has invalid or nonpositive solids')
    # Drop only empty container labels; preserve every solid/location/face.
    shape=solids[0] if len(solids)==1 else cq.Compound.makeCompound(solids)
    if len(compound.Faces())!=len(shape.Faces()):raise ValueError('Loose faces or non-solid detail requires review')
    if len(solids)!=entry.get('solidCount') or len(shape.Faces())!=entry.get('faceCount'):raise ValueError('Source structure differs from intake')
    b=shape.BoundingBox();bounds=[b.xmin,b.ymin,b.zmin,b.xmax,b.ymax,b.zmax];expected=entry.get('sourceBoundsMm')
    if not isinstance(expected,list) or len(expected)!=6 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in expected) or max(abs(a-b) for a,b in zip(bounds,expected))>.002:raise ValueError('Source dimensions/origin changed')
    if any(not 0.001<=v<=100000 for v in [b.xlen,b.ylen,b.zlen]):raise ValueError('Source extent unsupported')
    evidence={'sourceSha256':source_sha256,'stepSha256':source_sha256,'manifestSha256':manifest_hash,'units':'mm','originalStepUnits':units,'boundsMm':[b.xlen,b.ylen,b.zlen],'sourceBoundsMm':{'min':bounds[:3],'max':bounds[3:]},'solidCount':len(solids),'faceCount':len(shape.Faces()),'sourceToLocal':{'rotationDegXYZ':[0,0,0],'rotationOrderApplied':'Z,Y,X','translationMm':[0,0,0],'scale':1},'localFrame':'original source origin; no rotation, centering, scaling or healing','physicalFit':'UNKNOWN','interfaces':None,'massG':None,'sourceUrl':entry.get('sourceUrl'),'libraryReference':True}
    if cache is not None:cache[key]=(shape,evidence)
    return shape.copy(mesh=False),deepcopy(evidence)
