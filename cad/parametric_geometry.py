"""Bounded native geometry v2. Data only; independent worker admission and measurements."""
import math
import re

def obj(value,keys):
    if not isinstance(value,dict) or set(value)-set(keys): raise ValueError('geometry contract: unsupported fields/object')
def finite(value,lo,hi):
    if type(value) not in (int,float) or not math.isfinite(value) or not lo<=value<=hi: raise ValueError('geometry contract: finite bounded value required')
    return value
def ident(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}',value): raise ValueError('geometry contract: identifier required')
    return value
def text(value):
    if not isinstance(value,str) or not value.strip() or len(value)>1000 or re.search(r'[\x00-\x1f]',value): raise ValueError('geometry contract: reason required')
def seq(value,lo,hi):
    if not isinstance(value,list) or not lo<=len(value)<=hi: raise ValueError('geometry contract: invalid array cardinality')
    return value
def vector(value,limit):return [finite(x,-limit,limit) for x in seq(value,3,3)]
def frame(value):
    obj(value,['position','rotation']);vector(value.get('position'),500);vector(value.get('rotation'),360)
    return value
def profile(points):
    points=seq(points,3,32)
    for point in points:
        for x in seq(point,2,2):finite(x,-250,250)
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    def on(a,b,c):return abs(cross(a,b,c))<=1e-9 and all(min(a[i],b[i])-1e-9<=c[i]<=max(a[i],b[i])+1e-9 for i in range(2))
    for i,a in enumerate(points):
        b=points[(i+1)%len(points)]
        if math.dist(a,b)<1e-6:raise ValueError('degenerate profile edge')
        for j in range(i+1,len(points)):
            if j==(i+1)%len(points) or i==(j+1)%len(points):continue
            c,d=points[j],points[(j+1)%len(points)]
            if cross(a,b,c)*cross(a,b,d)<0 and cross(c,d,a)*cross(c,d,b)<0 or on(a,b,c) or on(a,b,d) or on(c,d,a) or on(c,d,b):raise ValueError('self-intersecting profile')
    area=sum(a[0]*points[(i+1)%len(points)][1]-a[1]*points[(i+1)%len(points)][0] for i,a in enumerate(points))/2
    if abs(area)<1e-6:raise ValueError('zero-area profile')
    return area
def validate_shape(shape):
    if shape['type']=='profileExtrusion':
        obj(shape,['type','points','height']);profile(shape.get('points'));finite(shape.get('height'),.5,500)
    elif shape['type']=='profileLoft':
        obj(shape,['type','sections']);sections=seq(shape.get('sections'),2,8);areas=[]
        for s in sections:obj(s,['z','points']);finite(s.get('z'),-250,250);areas.append(profile(s.get('points')))
        for i in range(1,len(sections)):
            if sections[i]['z']-sections[i-1]['z']<.5 or len(sections[i]['points'])!=len(sections[0]['points']) or areas[i]*areas[0]<=0:raise ValueError('loft z/count/winding mismatch')
    else:raise ValueError('unsupported profile shape')

def multiply(a,b):return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
def matrix(f):
    x,y,z=map(math.radians,f['rotation']);cx,sx,cy,sy,cz,sz=math.cos(x),math.sin(x),math.cos(y),math.sin(y),math.cos(z),math.sin(z)
    r=[[cy*cz,-cy*sz,sy],[cx*sz+sx*sy*cz,cx*cz-sx*sy*sz,-sx*cy],[sx*sz-cx*sy*cz,sx*cz+cx*sy*sz,cx*cy]]
    return [r[i]+[f['position'][i]] for i in range(3)]+[[0,0,0,1]]
def inverse(m):
    r=[[m[j][i] for j in range(3)] for i in range(3)]
    return [r[i]+[-sum(r[i][j]*m[j][3] for j in range(3))] for i in range(3)]+[[0,0,0,1]]

def validate_extension(spec):
    parts=spec['parts'];used=spec.get('placement') is not None or any('datums'in p or p['shape']['type'] in ('profileExtrusion','profileLoft') for p in parts)
    if 'geometryVersion'in spec and type(spec['geometryVersion']) is not int or (used or 'geometryVersion'in spec) and spec.get('geometryVersion')!=2:raise ValueError('geometryVersion:2 required')
    for p in parts:
        if p['shape']['type'] in ('profileExtrusion','profileLoft'):
            if p['kind']!='printed':raise ValueError('profile geometry must be printed')
            validate_shape(p['shape'])
            if p.get('fillet',0)!=0:raise ValueError('profile fillets unsupported')
        if 'datums'in p:
            seen=set()
            for d in seq(p['datums'],1,16):
                obj(d,['id','position','rotation']);ident(d.get('id'));frame({k:d.get(k) for k in ('position','rotation')})
                if d['id'] in seen:raise ValueError('duplicate datum')
                seen.add(d['id'])
    if 'placement'not in spec:return
    value=spec['placement'];obj(value,['version','roots','attachments'])
    if type(value.get('version')) is not int or value['version']!=1:raise ValueError('placement version unsupported')
    by_id={p['id']:p for p in parts};roots=set();links={};ids=set();reqs={r['id'] for r in spec.get('requirements',[])}
    for r in seq(value.get('roots'),1,48):
        obj(r,['partId','reason']);ident(r.get('partId'));text(r.get('reason'))
        if r['partId']not in by_id or r['partId']in roots:raise ValueError('invalid placement root')
        roots.add(r['partId'])
    for a in seq(value.get('attachments'),0,47):
        obj(a,['id','requirementId','parentId','parentDatum','childId','childDatum','offset','verification'])
        for k in ('id','requirementId','parentId','parentDatum','childId','childDatum'):ident(a.get(k))
        frame(a.get('offset'));v=a.get('verification')
        if isinstance(v,dict) and v.get('type')=='contact':obj(v,['type','maxGapMm','maxIntersectionMm3']);finite(v.get('maxGapMm'),0,.1);finite(v.get('maxIntersectionMm3'),0,.01)
        else:
            obj(v,['type','reason'])
            if v.get('type')!='frameOnly':raise ValueError('unsupported attachment verification')
            text(v.get('reason'))
        if a['id']in ids or a['childId']in links or a['childId']in roots:raise ValueError('duplicate/conflicting attachment')
        ids.add(a['id'])
        if a['requirementId']not in reqs:raise ValueError('unknown attachment requirement')
        for pid,did in ((a['parentId'],a['parentDatum']),(a['childId'],a['childDatum'])):
            if pid not in by_id or not any(d['id']==did for d in by_id[pid].get('datums',[])):raise ValueError('missing attachment datum')
        links[a['childId']]=a
    done={k:matrix(by_id[k]) for k in roots};active=set()
    def visit(k):
        if k in done:return done[k]
        if k in active:raise ValueError('cyclic attachment')
        if k not in links:raise ValueError('unbound part')
        active.add(k);a=links[k]
        datum=lambda pid,did:matrix(next(d for d in by_id[pid]['datums'] if d['id']==did))
        m=multiply(multiply(multiply(visit(a['parentId']),datum(a['parentId'],a['parentDatum'])),matrix(a['offset'])),inverse(datum(k,a['childDatum'])))
        actual=matrix(by_id[k])
        if max(abs(m[i][j]-actual[i][j]) for i in range(4) for j in range(4))>1e-7:raise ValueError(f'{k}: supplied pose contradicts attachment frame')
        active.remove(k);done[k]=m;return m
    for p in parts:visit(p['id'])

def build(cq,shape):
    validate_shape(shape)
    if shape['type']=='profileExtrusion':return cq.Workplane('XY').polyline(shape['points']).close().extrude(shape['height']).val()
    wires=[cq.Wire.makePolygon([cq.Vector(x,y,s['z']) for x,y in s['points']],close=True) for s in shape['sections']]
    return cq.Solid.makeLoft(wires,ruled=True)

def attachment_checks(spec,world_shapes):
    by_id=dict(world_shapes);checks=[]
    for a in spec.get('placement',{}).get('attachments',[]):
        v=a['verification'];observed={'framePose':'MATCH','poseTolerance':1e-7};status='UNKNOWN'
        if v['type']=='contact':
            parent,child=by_id[a['parentId']],by_id[a['childId']];gap=parent.distance(child);intersection=parent.intersect(child).Volume()
            observed.update(distanceMm=gap,intersectionMm3=intersection)
            status='PASS' if gap<=v['maxGapMm'] and intersection<=v['maxIntersectionMm3'] else 'FAIL'
        checks.append({'id':'attachment:'+a['id'],'label':'Declared attachment '+a['id'],'status':status,'method':'Native frame consistency and exact BRep distance/intersection','observed':observed,'required':v,'details':'Requirement '+a['requirementId']+'. Frame match/contact do not prove fastening, fit, strength or manufacturability.'})
    return checks
