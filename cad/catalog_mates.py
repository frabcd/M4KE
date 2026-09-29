"""Inert source-interface selection, native nominal geometry, never physical fit.

No nearest-part pairing and no model-supplied axes, centres, paths or dimensions.
The immutable catalogue supplies interface metadata; exact imported cylinder
faces independently delimit its support. D-flat/tolerance/retention remain UNKNOWN.
"""
import hashlib
import json
import math
import re

from catalog_geometry import CatalogError, resolve_component

EPS = 1e-4  # Recorded catalogue coordinates are rounded to 7 decimal places.
ANGLE_DEG = .1
SUPPORTED = {'shaft-axis', 'd-shaft-bore', 'cylindrical-bore'}


def dot(a, b): return sum(x*y for x, y in zip(a, b))
def sub(a, b): return [x-y for x, y in zip(a, b)]
def norm(a): return math.sqrt(dot(a, a))


def vector(value, label):
    if not isinstance(value, list) or len(value) != 3 or any(type(x) not in (int, float) or not math.isfinite(x) or abs(x)>100000 for x in value):
        raise CatalogError('Invalid interface '+label)
    return value


def transform(v, rotation, translation=None):
    v=list(v)
    for (a,b), degree in zip(((0,1),(2,0),(1,2)), reversed(rotation)):
        c=math.cos(math.radians(degree));s=math.sin(math.radians(degree));v[a],v[b]=c*v[a]-s*v[b],s*v[a]+c*v[b]
    return [x+(translation[i] if translation else 0) for i,x in enumerate(v)]


def merge(intervals):
    output=[]
    for lo,hi in sorted(intervals):
        if hi-lo<=EPS:continue
        if output and lo<=output[-1][1]+EPS:output[-1][1]=max(hi,output[-1][1])
        else:output.append([lo,hi])
    return output


def load_interface(component, interface, metadata, local_shape, root):
    """Bind source evidence/frame and verify actual native cylindrical surfaces."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder
    geometry=component['geometry'];expected=metadata['stepSha256']
    if interface.get('type') not in SUPPORTED or interface.get('coordinateFrame')!='catalog-local-centred-mm' or interface.get('reconciliation')!='source-step-to-catalog-local-reconciled':
        raise CatalogError('Interface type or reconciled coordinate frame is unsupported')
    original=geometry.get('originalPath',geometry['step'])
    if interface.get('sourceSha256')!=expected or interface.get('sourceArtifact')!=original:
        raise CatalogError('Interface source SHA/path does not match selected STEP')
    if interface.get('evidenceArtifact')!='interface-surface-inventory.json':
        raise CatalogError('Interface evidence path is not allowlisted')
    evidence=root/'interface-surface-inventory.json'
    if evidence.is_symlink() or not evidence.is_file() or not 1<=evidence.stat().st_size<=2*1024*1024:
        raise CatalogError('Interface inventory missing or outside size/type bounds')
    raw=evidence.read_bytes();digest=hashlib.sha256(raw).hexdigest()
    if digest!=interface.get('evidenceSha256'):raise CatalogError('Interface inventory SHA256 mismatch')
    inventory=json.loads(raw)
    rows=[r for r in inventory if isinstance(r,dict) and r.get('sha256')==expected and r.get('path')==original] if isinstance(inventory,list) else []
    if len(rows)!=1:raise CatalogError('Inventory does not uniquely bind selected source')
    frame=metadata['sourceToLocal'];declared=interface.get('sourceToLocal',{})
    if declared.get('scale')!=1 or declared.get('rotationOrderApplied')!='Z,Y,X' or declared.get('rotationDegXYZ')!=frame['rotationDegXYZ']:
        raise CatalogError('Interface source-to-local rotation/scale mismatch')
    if norm(sub(vector(declared.get('translationMm'),'frame translation'),frame['translationMm']))>EPS:
        raise CatalogError('Interface source-to-local translation mismatch')
    d=interface.get('dimensions',{});source=interface.get('sourceCoordinates',{})
    centres=d.get('centresMm');source_centres=source.get('centresMm')
    if not isinstance(centres,list) or len(centres)!=2 or not isinstance(source_centres,list) or len(source_centres)!=2:
        raise CatalogError('Interface must declare exactly two interval endpoints, not a hole pattern')
    axis=vector(d.get('axis'),'axis');source_axis=vector(source.get('axis'),'source axis')
    if abs(norm(axis)-1)>1e-6 or abs(norm(source_axis)-1)>1e-6:raise CatalogError('Interface axis must be unit length')
    if norm(sub(axis,transform(source_axis,frame['rotationDegXYZ'])))>1e-6:raise CatalogError('Interface source axis transform mismatch')
    for local,point in zip(centres,source_centres):
        if norm(sub(vector(local,'endpoint'),transform(vector(point,'source endpoint'),frame['rotationDegXYZ'],frame['translationMm'])))>EPS:
            raise CatalogError('Interface source endpoint transform mismatch')
    delta=sub(centres[1],centres[0]);length=dot(delta,axis)
    if length<=EPS or norm(sub(delta,[length*x for x in axis]))>EPS:raise CatalogError('Interface endpoints are not a positive axial interval')
    diameter=d.get('diameterMm')
    if type(diameter) not in (int,float) or not math.isfinite(diameter) or not 0<diameter<=500:raise CatalogError('Invalid nominal interface diameter')
    indices=interface.get('faceIndices');available={r.get('faceIndex'):r for r in rows[0].get('cylinders',[]) if isinstance(r,dict)}
    if not isinstance(indices,list) or not 1<=len(indices)<=64 or any(type(i) is not int or i<0 for i in indices) or len(set(indices))!=len(indices):raise CatalogError('Invalid interface face selection')
    faces=local_shape.Faces();intervals=[]
    for index in indices:
        if index not in available or index>=len(faces):raise CatalogError('Interface native face not bound by inventory')
        recorded=available[index]
        if abs(recorded.get('radiusMm',-1)*2-diameter)>EPS:raise CatalogError('Inventory cylinder diameter mismatch')
        surface=BRepAdaptor_Surface(faces[index].wrapped,True)
        if surface.GetType()!=GeomAbs_Cylinder:raise CatalogError('Selected native face is not cylindrical')
        cylinder=surface.Cylinder();native_axis=list(cylinder.Axis().Direction().Coord());origin=list(cylinder.Location().Coord())
        offset=sub(origin,centres[0]);radial=norm(sub(offset,[dot(offset,axis)*x for x in axis]))
        if abs(cylinder.Radius()*2-diameter)>EPS or abs(dot(native_axis,axis))<1-1e-8 or radial>EPS:
            raise CatalogError('Native cylinder does not match selected interface axis/diameter')
        endpoints=[[origin[i]+native_axis[i]*v for i in range(3)] for v in (surface.FirstVParameter(),surface.LastVParameter())]
        projected=[dot(sub(p,centres[0]),axis) for p in endpoints]
        if any(not math.isfinite(v) for v in projected):raise CatalogError('Unbounded native cylindrical support')
        lo=max(0,min(projected));hi=min(length,max(projected))
        if hi>lo:intervals.append([lo,hi])
    intervals=merge(intervals)
    if not intervals:raise CatalogError('No native cylindrical support inside declared interface interval')
    return {'id':interface['id'],'type':interface['type'],'axis':axis,'origin':centres[0],
            'supportIntervalsMm':intervals,'nominalIntervalMm':[0,length],'diameterMm':diameter,
            'lineage':{'catalogId':component['id'],'sku':component.get('sku'),'interfaceId':interface['id'],
                       'stepSha256':expected,'manifestSha256':metadata['manifestSha256'],'evidenceSha256':digest,
                       'sourceToLocal':frame,'nativeFaceIndices':indices},
            'dFlatOrientation':'UNKNOWN','tolerance':'UNKNOWN','retention':'UNKNOWN'}


def evaluate_mate(request, shaft, bore, shaft_part, bore_part):
    """Nominal transformed native support only; no signed-interference exemption."""
    def world(record,part):
        origin=transform(record['origin'],part['rotation'],part['position']);axis=transform(record['axis'],part['rotation'])
        ends=[[[origin[i]+axis[i]*v for i in range(3)] for v in interval] for interval in record['supportIntervalsMm']]
        return origin,axis,ends
    so,sa,se=world(shaft,shaft_part);bo,ba,be=world(bore,bore_part)
    cosine=max(-1,min(1,dot(sa,ba)));angle=math.degrees(math.acos(abs(cosine)))
    si=merge([sorted(dot(sub(p,bo),ba) for p in ends) for ends in se]);bi=merge([sorted(dot(sub(p,bo),ba) for p in ends) for ends in be])
    overlap=merge([[max(a,c),min(b,d)] for a,b in si for c,d in bi if min(b,d)>max(a,c)])
    engagement=sum(b-a for a,b in overlap);parallel=angle<=ANGLE_DEG+1e-8
    radial=None
    if abs(cosine)>1e-8:
        distances=[]
        for q in [v for interval in overlap for v in interval] or [0]:
            t=(q-dot(sub(so,bo),ba))/cosine;p=[so[i]+sa[i]*t-bo[i] for i in range(3)]
            distances.append(norm(sub(p,[dot(p,ba)*x for x in ba])))
        radial=max(distances)
    gap=bore['diameterMm']-shaft['diameterMm'];lo,hi=request['diametralClearanceMm']
    geometry_ok=parallel and radial is not None and gap>=lo-EPS and gap<=hi+EPS and radial<=max(0,gap/2)+EPS and engagement>=request['minimumEngagementMm']-EPS
    return {'status':'UNKNOWN' if geometry_ok else 'FAIL','nominalGeometryStatus':'PASS' if geometry_ok else 'FAIL',
            'axisAngleDeg':angle,'maximumAxisAngleDeg':ANGLE_DEG,'radialAxisOffsetMm':radial,
            'axialEngagementMm':engagement,'diametralClearanceMm':gap,'overlapIntervalsMm':overlap,
            'shaftWorldAxis':sa,'boreWorldAxis':ba,'shaftSupportIntervalsMm':si,'boreSupportIntervalsMm':bi,
            'lineage':[shaft['lineage'],bore['lineage']],'dFlatOrientation':'UNKNOWN','tolerance':'UNKNOWN','retention':'UNKNOWN','physicalFit':'UNKNOWN'}


def catalog_mate_checks(spec,local_shapes,metadata,catalog_root=None):
    parts={p['id']:p for p in spec['parts']};selected={};errors={};records={};covered=set();checks=[]
    for pid in metadata:
        try:
            root,manifest,component,_,_=resolve_component(parts[pid]['shape']['catalogId'],catalog_root)
            if hashlib.sha256(manifest.read_bytes()).hexdigest()!=metadata[pid]['manifestSha256']:
                raise CatalogError('Catalog manifest changed after native part import')
            all_interfaces=component.get('interfaces',[])
            if not isinstance(all_interfaces,list) or len(all_interfaces)>64:raise CatalogError('Catalog interface count exceeds 64')
            interfaces=[i for i in all_interfaces if isinstance(i,dict) and i.get('type') in SUPPORTED]
            if any(not isinstance(i.get('id'),str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}',i['id']) for i in interfaces):raise CatalogError('Invalid source interface ID')
            if len({i.get('id') for i in interfaces})!=len(interfaces):raise CatalogError('Duplicate catalog interface IDs')
            for interface in interfaces:
                key=(pid,interface.get('id'));selected[key]=interface
                try:records[key]=load_interface(component,interface,metadata[pid],local_shapes[pid],root)
                except (CatalogError,ValueError,KeyError,TypeError,OSError,RuntimeError) as error:errors[key]=str(error)
        except (CatalogError,ValueError,KeyError,TypeError,OSError,RuntimeError) as error:
            checks.append({'id':'catalog-mate-source:'+pid,'label':'Catalog mating source availability','status':'UNKNOWN','method':'Source-bound interface resolution','observed':str(error),'required':'Verified catalog/interface evidence','details':'No interface data is inferred.'})
    for r in spec.get('verificationRequests',[]):
        if r['type']!='catalogMate':continue
        sk=(r['shaftPartId'],r['shaftInterfaceId']);bk=(r['borePartId'],r['boreInterfaceId']);shaft=records.get(sk);bore=records.get(bk)
        observed={'requirementId':r['requirementId'],'physicalFit':'UNKNOWN'}
        if not shaft or not bore or shaft['type']!='shaft-axis' or bore['type'] not in {'d-shaft-bore','cylindrical-bore'}:
            observed['unavailable']=[{'partId':k[0],'interfaceId':k[1],'reason':errors.get(k,'Missing interface or unsupported shaft/bore role')} for k in (sk,bk)]
            status='UNKNOWN'
        else:
            observed.update(evaluate_mate(r,shaft,bore,parts[sk[0]],parts[bk[0]]));status=observed.pop('status');covered.update((sk,bk))
        checks.append({'id':'request:'+r['id'],'label':'Requested catalog shaft/bore mate','status':status,
                       'method':'Hash-bound source interfaces and native cylindrical support transformed into world mm',
                       'observed':observed,'required':{'minimumEngagementMm':r['minimumEngagementMm'],'diametralClearanceMm':r['diametralClearanceMm'],'maximumAxisAngleDeg':ANGLE_DEG},
                       'details':'Nominal geometry only. D-flat orientation, manufacturing tolerance, retention/load capacity and insertion access remain UNKNOWN. No collision waiver or physical-fit claim.'})
    for key in selected:
        if key not in covered:
            checks.append({'id':'catalog-mate-uncovered:'+':'.join(key),'label':'Selected shaft/bore interface lacks a supported mating check','status':'UNKNOWN',
                           'method':'Exact selected-interface coverage, no automatic nearest-part pairing','observed':{'partId':key[0],'interfaceId':key[1],'reason':errors.get(key,'No valid catalogMate request covers this interface')},
                           'required':'Qwen selects a source-bound shaft/bore pair and the host executes its check','details':'Non-intersection or floating geometry does not establish mechanical coupling.'})
    return checks
