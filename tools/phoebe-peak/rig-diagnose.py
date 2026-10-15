import json,base64,sys,numpy as np,trimesh,matplotlib
matplotlib.use('Agg');import matplotlib.pyplot as plt
rig=json.load(open(sys.argv[1]));mesh=list(trimesh.load(sys.argv[2]).geometry.values())[0];V=np.asarray(mesh.vertices)
ids=np.frombuffer(base64.b64decode(rig['skinIndex']),np.uint8).reshape(-1,4);ws=np.frombuffer(base64.b64decode(rig['skinWeight']),np.uint8).reshape(-1,4)
dom=ids[:,0];n=len(rig['bones']);cm=plt.get_cmap('tab20')
fig,ax=plt.subplots(1,2,figsize=(16,9))
for a,(i,j) in zip(ax,[(0,1),(2,1)]):
    a.scatter(V[:,i],V[:,j],s=1.2,c=[cm(d%20) for d in dom]);a.set_aspect('equal')
    for b in rig['bones']:
        h,t=b['head'],b['tail'];a.plot([h[i],t[i]],[h[j],t[j]],'k-',lw=1);a.text(h[i],h[j],b['name'],fontsize=6)
plt.tight_layout();plt.savefig(sys.argv[3],dpi=80)
