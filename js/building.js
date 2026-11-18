// 3D表示：店舗ごとの建物データ（stores.building）から建物を生成し、客室・共用部の選択とステータス色を扱う
const canvas=document.getElementById('c'),scene=new THREE.Scene();scene.background=new THREE.Color(0x111a28);
const camera=new THREE.PerspectiveCamera(45,1,.1,1000);camera.position.set(15,12,19);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
scene.add(new THREE.HemisphereLight(0xdbe8ff,0x2a3224,2));let dl=new THREE.DirectionalLight(0xffffff,2);dl.position.set(8,18,14);scene.add(dl);
let exploded=false;
const mat=(color,o={})=>new THREE.MeshStandardMaterial({color,roughness:.7,...o});
const box=(w,h,d,m,x,y,z,p)=>{let b=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);b.position.set(x,y,z);p.add(b);return b};
const M={wall:mat(0xd5d9de),white:mat(0xf3f3f0),navy:mat(0x1c2448),beige:mat(0xd9ceb4),glass:mat(0xbcd6e6,{transparent:true,opacity:.35,roughness:.1}),pipe:mat(0x3a3f48),ac:mat(0xe6e6e1),eq:mat(0x9aa3ad),asphalt:mat(0x474c52,{roughness:.95}),line:mat(0xd9b84a)};
// 建物の寸法は共通。階数・各階の部屋数・部屋タイプ・共用部は店舗ごとのデータ（stores.building）で決めるので、店舗追加時にアプリを作り直さない
const BW=1.6,FH=1.1,GH=1.35,LIFT=.45;
const DEFAULT_BUILDING={firstFloor:2,floors:4,roomsPerFloor:9,ground:'parking',roomTypes:{B:[1,9]},defaultType:'A',interiors:true,commonAreas:['屋上','駐車場','外壁','廊下','エントランス']};
let B=DEFAULT_BUILDING,PER=9,X0=-PER*BW/2,FLOORS=[2,3,4,5],ids=[];
const rooms=[],floors=[],commons=[],building=new THREE.Group();scene.add(building);
const roomNo=(f,n)=>`${f}${String(n).padStart(2,'0')}`;
function roomType(id){let n=+String(id).slice(-2);for(const [t,list] of Object.entries(B.roomTypes||{}))if((list||[]).includes(n))return t;return B.defaultType||'A'}
const hasInterior=id=>!!B.interiors&&['A','B'].includes(roomType(id));
const shared=new Set(Object.values(M));
function clearGroup(g){g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material&&!shared.has(o.material)&&!o.isSprite)o.material.dispose()});g.clear()}
function area(m,name,g){m.userData.area=name;m.userData.group=g||building;commons.push(m);return m}
function buildBuilding(cfg){
 B={...DEFAULT_BUILDING,...(cfg||{})};PER=Math.max(1,Math.min(30,B.roomsPerFloor|0||9));X0=-PER*BW/2;
 FLOORS=[];for(let i=0;i<Math.max(1,Math.min(20,B.floors|0||4));i++)FLOORS.push((B.firstFloor||2)+i);
 ids=[];FLOORS.forEach(f=>{for(let n=1;n<=PER;n++)ids.push(roomNo(f,n))});
 clearGroup(building);rooms.length=floors.length=commons.length=0;markers.clear();
 const W=PER*BW,F0=FLOORS[0];
 area(box(W+11.6,.3,17,M.asphalt,0,-.15,2,building),'駐車場');
 for(let k=0;k<=PER;k++)box(.06,.02,2.2,M.line,X0+k*BW+(k===0?.2:k===PER?-.2:0),.01,.3,building);
 // 1F：紺の梁と柱で支えたピロティ駐車場・エントランス
 const g1=new THREE.Group();building.add(g1);
 box(W+.1,.25,3.3,M.navy,0,GH-.125,.4,g1);
 [...new Set([0,2,4,Math.round(PER*.72*2)/2,PER])].filter(k=>k<=PER).forEach(k=>{let x=X0+k*BW+(k===0?.14:k===PER?-.14:0);box(.28,GH-.25,.28,M.navy,x,(GH-.25)/2,1.9,g1);box(.28,GH-.25,.28,M.navy,x,(GH-.25)/2,-1.1,g1)});
 area(box(1.3,GH-.3,.9,M.beige,X0+.8,(GH-.3)/2,-1.6,g1),'エントランス',g1);
 // 2F〜：客室・バルコニー・室外機・共用廊下・妻壁
 FLOORS.forEach((f,i)=>{const g=new THREE.Group();g.userData={floor:f,idx:i,baseY:GH+i*FH};g.position.y=g.userData.baseY;building.add(g);floors.push(g);
  box(W,.1,3.3,M.white,0,.05,.4,g);area(box(W,.1,.8,M.white,0,.05,-1.6,g),'廊下',g);box(W,.45,.05,M.wall,0,.3,-2,g);
  for(let k=0;k<=PER;k++)box(.06,FH-.1,.85,k===0?M.navy:M.white,X0+k*BW+(k===0?.03:k===PER?-.03:0),FH/2,1.62,g);
  for(let k=1;k<=Math.min(3,PER);k++)box(.06,FH,.06,M.pipe,X0+k*BW+.12,FH/2,1.98,g);
  area(box(.08,FH-.02,2.5,M.wall,-X0+.04,FH/2,0,g),'外壁',g);area(box(.08,FH-.02,2.5,M.wall,X0-.04,FH/2,0,g),'外壁',g);
  for(let n=1;n<=PER;n++){let id=roomNo(f,n),x=X0+(n-.5)*BW;
   let m=box(BW-.06,FH-.12,2.4,mat(ROOM_BASE),x,FH/2+.04,0,g);m.userData={id,floor:f};rooms.push(m);
   let wm=new THREE.MeshBasicMaterial({color:0x73839b}),win=new THREE.Mesh(new THREE.PlaneGeometry(.95,.72),wm),door=new THREE.Mesh(new THREE.PlaneGeometry(.38,.75),wm);
   win.position.set(-.1,-.06,1.201);door.position.set(.3,-.05,-1.201);door.rotation.y=Math.PI;m.add(win,door);m.userData.win=win;
   box(.42,.3,.22,M.ac,x+BW*.27,.25,1.42,g);
   box(BW-.08,.42,.03,f===F0?M.beige:M.glass,x,.34,2.03,g);box(BW-.04,.04,.06,M.white,x,.57,2.03,g)}});
 // 屋上：紺のパラペット・受水槽・アンテナ
 const roof=new THREE.Group();roof.userData={floor:'R',idx:FLOORS.length,baseY:GH+FLOORS.length*FH};roof.position.y=roof.userData.baseY;building.add(roof);floors.push(roof);
 area(box(W+.1,.15,4.2,M.white,0,.075,0,roof),'屋上',roof);box(W+.1,.3,.08,M.navy,0,.28,2.06,roof);box(W+.1,.3,.08,M.navy,0,.28,-2.06,roof);
 box(.9,.6,.7,M.eq,X0+Math.min(1.5,PER*.17)*BW,.45,-.5,roof);box(.05,1.3,.05,M.eq,X0+PER*.73*BW,.8,-1.4,roof);
 refreshStatus();
}
// ステータス色（要件定義書 4章）。部屋は箱の色、共用部は丸い目印で示す
const STATUS_HEX={red:0xe5484d,yellow:0xf2c230,blue:0x3b82f6,gray:0x8b95a3,green:0x3fae5a},ROOM_BASE=0xd5d9de;
let statusMap={room:{},common:{}};
const markers=new Map(),markerTex={};
function markerTexture(c){if(markerTex[c])return markerTex[c];let cv=document.createElement('canvas');cv.width=cv.height=64;let x=cv.getContext('2d');
 x.beginPath();x.arc(32,32,26,0,7);x.fillStyle='#'+STATUS_HEX[c].toString(16).padStart(6,'0');x.fill();x.lineWidth=6;x.strokeStyle='#ffffff';x.stroke();
 let t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return markerTex[c]=t}
function setStatus(m){statusMap=m||{room:{},common:{}};refreshStatus()}
function refreshStatus(){
 markers.forEach(s=>{s.parent&&s.parent.remove(s);s.material.dispose()});markers.clear();
 const mk=(c,size)=>{let s=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTexture(c),depthTest:false}));s.scale.set(size,size,size);s.renderOrder=10;return s};
 // 部屋：箱と窓をステータス色にし、バルコニーの手前に目印を出す（バルコニーに隠れて見えにくいため）
 rooms.forEach(r=>{let c=statusMap.room[r.userData.id];r.material.color.setHex(c?STATUS_HEX[c]:ROOM_BASE);r.userData.win.material.color.setHex(c?STATUS_HEX[c]:0x73839b);
  if(!c)return;let s=mk(c,.45);s.position.set(r.position.x,FH*.55,2.25);r.parent.add(s);markers.set('room:'+r.userData.id,s)});
 let seen=new Set();
 commons.forEach(m=>{let name=m.userData.area,c=statusMap.common[name];if(!c||seen.has(name))return;seen.add(name);
  let s=mk(c,.7);
  let p=m.position.clone();p.y+=.6;if(name==='駐車場'){p.set(X0+PER*BW*.6,.5,4.2)}s.position.copy(p);m.userData.group.add(s);markers.set(name,s)});
}
// 室内3D：タイプA（reference/タイプAベッド.jpg・タイプAベッド２.jpg 準拠）。壁は片面描画なので手前側が自動で消え、ドールハウス表示になる
// 入口(z-)→バルコニー(z+)。バルコニー側を向いて右(x-)がグレーのアクセント壁とベッド、左(x+)がキッチン・TV
// 部屋タイプは建物データの roomTypes で決める（既定の建物：各階01・09号室がタイプB、それ以外がタイプA）
const RW=3,RD=7,RH=2.5;
const roomView=new THREE.Group(),inner=new THREE.Group();inner.position.y=-RH/2;roomView.add(inner);roomView.scale.setScalar(2);roomView.position.y=3;roomView.visible=false;scene.add(roomView);
const roomViewB=new THREE.Group(),innerB=new THREE.Group();innerB.position.y=-RH/2;roomViewB.add(innerB);roomViewB.scale.setScalar(2);roomViewB.position.y=3;roomViewB.visible=false;scene.add(roomViewB);let tgt=inner,curType='A';
const floorTex=(()=>{let c=document.createElement('canvas');c.width=c.height=256;let x=c.getContext('2d');x.fillStyle='#2a1c12';x.fillRect(0,0,256,256);for(let i=0;i<8;i++){x.fillStyle=`hsl(25,${28+i%3*4}%,${24+(i*7)%9}%)`;x.fillRect(i*32,0,30,256)}let t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3,3);t.colorSpace=THREE.SRGBColorSpace;return t})();
const R={wall:mat(0xf2f0eb,{roughness:.9}),gray:mat(0x5c5e63,{roughness:.95}),floor:mat(0xffffff,{map:floorTex,roughness:.6}),white:mat(0xf6f6f4),sheet:mat(0xc9cacd,{roughness:.9}),wood:mat(0x8a6a4a),door:mat(0x8b887c),black:mat(0x17181b),steel:mat(0xb8bcc2,{metalness:.5,roughness:.4}),curtain:mat(0xd4d0bd,{roughness:1}),table:mat(0xd8c19a),lamp:mat(0xffe9b0,{emissive:0xffe9b0,emissiveIntensity:.9})};
const plane=(w,h,m,x,y,z,ry,rx)=>{let p=new THREE.Mesh(new THREE.PlaneGeometry(w,h),m);p.position.set(x,y,z);p.rotation.set(rx||0,ry||0,0);tgt.add(p);return p};
const cyl=(r,h,m,x,y,z)=>{let c=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,20),m);c.position.set(x,y,z);tgt.add(c)};
plane(RW,RD,R.floor,0,0,0,0,-Math.PI/2);
plane(RW,RH,R.wall,0,RH/2,-RD/2,0);plane(RW,RH,R.wall,0,RH/2,RD/2,Math.PI);plane(RD,RH,R.wall,-RW/2,RH/2,0,Math.PI/2);plane(RD,RH,R.wall,RW/2,RH/2,0,-Math.PI/2);
plane(4.5,RH-.35,R.gray,-RW/2+.005,(RH-.35)/2,1.25,Math.PI/2);
// 入口：玄関ドア・浴室ユニット（白い間仕切り）・木目の浴室ドア
box(1,2.1,.03,R.black,.3,1.05,-RD/2+.015,inner);plane(.84,2.02,R.door,.3,1.01,-RD/2+.035,0);
// 浴室ユニット（右・ベッド側）＝水回りの部屋。外観は白い箱。木目のドアをタップすると開いて（手前の壁が低くなり）中が見える
// ドアを開けるとまず正面(x-)の木目の壁の前に中央のトイレ、その右(z-)に洗濯機、左(z+)に仕切りの向こうの浴室（reference/タイプAトイレ.jpg・タイプAバス.jpg 準拠）
const H=RH-.3,BATH=mat(0xe9e4d8,{roughness:.5}),MARB=mat(0x3b2a26,{roughness:.4}),MIRR=mat(0xcfd8dc,{metalness:.8,roughness:.1}),AMB=mat(0xc89b3c,{roughness:.4}),WOODD=mat(0x8a6a4a,{side:THREE.DoubleSide});
const frontWalls=new THREE.Group();inner.add(frontWalls);
box(.06,H,.7,R.wall,-.33,H/2,-3.15,frontWalls);box(.06,H,1,R.wall,-.33,H/2,-1.5,frontWalls);box(.06,H-2,.8,R.wall,-.33,2+(H-2)/2,-2.4,frontWalls);
box(1.2,H,.06,R.wall,-.9,H/2,-1.03,inner);
const bathCeil=box(1.2,.05,2.5,R.wall,-.9,H-.025,-2.25,inner);
// トイレ（正面中央・木目の壁）
plane(.9,H,R.wood,-RW/2+.004,H/2,-2.4,Math.PI/2);
box(.2,.42,.4,R.white,-1.4,.63,-2.4,inner);box(.58,.14,.38,R.white,-1.14,.4,-2.4,inner);box(.5,.04,.34,R.white,-1.12,.49,-2.4,inner);cyl(.1,.4,R.white,-1.14,.2,-2.4);cyl(.05,.12,R.white,-1.4,.9,-2.4);
// 洗濯機（トイレの右・防水パン付き）
box(.65,.05,.62,R.white,-.93,.025,-3.2,inner);box(.55,.88,.5,R.white,-.95,.49,-3.2,inner);box(.4,.02,.4,R.black,-.95,.935,-3.2,inner);box(.1,.04,.45,R.steel,-.76,.94,-3.2,inner);
// 浴室（トイレの左・仕切りの向こう）。廊下側にグレーのドア、浴槽、石目パネル、鏡、シャワー
box(1.14,H,.04,R.wall,-.93,H/2,-1.9,inner);plane(.6,1.95,R.door,-.8,.98,-1.921,Math.PI);
plane(1.14,.87,BATH,-.93,.004,-1.465,0,-Math.PI/2);
plane(.9,H,MARB,-RW/2+.004,H/2,-1.45,Math.PI/2);
box(1,.55,.7,BATH,-.9,.275,-1.45,inner);box(.88,.02,.58,R.sheet,-.9,.56,-1.45,inner);
box(.12,.05,.1,R.steel,-1.42,.85,-1.45,inner);cyl(.03,.12,R.white,-1.44,1.5,-1.65);
plane(.4,.8,MIRR,-RW/2+.012,1.3,-1.25,Math.PI/2);box(.06,.03,.7,R.sheet,-1.46,.95,-1.45,inner);
for(let i=0;i<3;i++)cyl(.025,.14,AMB,-1.45,1.03,-1.6+i*.07);
box(.03,.03,.8,R.steel,-1,2,-1.45,inner);
const doorPivot=new THREE.Group();doorPivot.position.set(-.29,0,-2.8);inner.add(doorPivot);
const doorLeaf=new THREE.Mesh(new THREE.PlaneGeometry(.8,2),WOODD);doorLeaf.rotation.y=Math.PI/2;doorLeaf.position.set(0,1,.4);doorPivot.add(doorLeaf);
const doorKnob=new THREE.Mesh(new THREE.BoxGeometry(.04,.06,.1),R.steel);doorKnob.position.set(.02,1,.7);doorPivot.add(doorKnob);
const doorHits=[doorLeaf,doorKnob];let doorOpen=false;
// キッチン・冷蔵庫・電子レンジ・ケトル
box(.6,.85,1.4,R.white,1.2,.425,-2.4,inner);box(.6,.03,.5,R.steel,1.2,.865,-2.4,inner);box(.5,.5,.6,R.black,1.25,1.9,-2.4,inner);
box(.55,1.2,.6,R.white,1.22,.6,-1.2,inner);box(.5,.3,.38,R.white,1.22,1.35,-1.2,inner);cyl(.1,.25,R.white,1.2,1.62,-1.2);
// ダブルベッド（頭側を浴室ユニットに付ける）
box(1.4,.28,2,R.white,-.8,.14,0,inner);box(1.38,.2,1.98,R.sheet,-.8,.38,0,inner);box(1.4,.21,.55,R.white,-.8,.385,-.72,inner);
box(.55,.12,.38,R.white,-1.1,.54,-.78,inner);box(.55,.12,.38,R.white,-.5,.54,-.78,inner);box(.4,.08,.3,R.white,-.8,.52,.6,inner);
// バルコニー側：カーテン・エアコン・テーブルセット・TV・壁付け照明
for(let i=0;i<12;i++)box(.17,2.15,.08,R.curtain,-.9+i*.17,1.125,RD/2-.08+(i%2?.03:0),inner);
box(.85,.28,.22,R.white,.5,2.1,RD/2-.11,inner);box(.8,.04,.2,R.steel,.5,1.95,RD/2-.11,inner);
cyl(.3,.04,R.table,-.8,.7,3);cyl(.03,.7,R.table,-.8,.35,3);box(.4,.04,.4,R.black,-.35,.45,3,inner);box(.4,.4,.04,R.black,-.35,.67,3.2,inner);box(.4,.4,.35,R.black,-1.05,.2,2.45,inner);
box(.06,.55,.95,R.black,RW/2-.03,1.3,1.8,inner);box(.1,.2,.2,R.lamp,-RW/2+.05,1.55,.2,inner);box(.1,.2,.2,R.lamp,RW/2-.05,1.7,2.8,inner);
// タイプB（reference/タイプBベッド.jpg 準拠）：201・209〜501・509号室。右奥(x+, z-)に入口、左(x-)がグレーのアクセント壁とベッド2台
let bLeaf,bPart,bAW,bOpen=false;
tgt=innerB;
{const W=3.6,D=7,I=innerB,PUR=mat(0x6a4c93,{roughness:.8}),CH=mat(0xd9c29a),DARK=mat(0x4a2c22),PINK=mat(0xe84a96);
plane(W,D,R.floor,0,0,0,0,-Math.PI/2);
plane(W,RH,R.wall,0,RH/2,D/2,Math.PI);plane(D,RH,R.wall,-W/2,RH/2,0,Math.PI/2);plane(D,RH,R.wall,W/2,RH/2,0,-Math.PI/2);
plane(7,RH-.35,R.gray,-W/2+.005,(RH-.35)/2,0,Math.PI/2);
// 入口（右奥）：木目のドア
// 入口の拡張：奥壁(z=-3.5)の右奥(x≈1.2)にスライドドア。その奥(z:-6〜-3.5)に約4.5畳の玄関スペース（タイプB洗面台・洗濯機・トイレ・タイプAと同じ浴室がつながる）
// スライドドアをタップすると開き、仕切りが低くなって中が見える（reference/タイプB洗面台.jpg・タイプBトイレ.jpg、浴室はタイプAバス準拠）
bPart=new THREE.Group();I.add(bPart);bAW=new THREE.Group();I.add(bAW);
tgt=bPart;
plane(2.58,RH,R.wall,-.51,RH/2,-D/2,0);plane(.18,RH,R.wall,1.71,RH/2,-D/2,0);plane(.84,RH-2.02,R.wall,1.2,(2.02+RH)/2,-D/2,0);
plane(2.58,RH,R.wall,-.51,RH/2,-D/2-.002,Math.PI);plane(.18,RH,R.wall,1.71,RH/2,-D/2-.002,Math.PI);plane(.84,RH-2.02,R.wall,1.2,(2.02+RH)/2,-D/2-.002,Math.PI);
tgt=innerB;
bLeaf=new THREE.Mesh(new THREE.PlaneGeometry(.84,2.02),mat(0xb78a5a,{side:THREE.DoubleSide}));bLeaf.position.set(1.2,1.01,-D/2+.035);I.add(bLeaf);
{const Z0=-6,AX=-4.75,BA=mat(0xe9e4d8,{roughness:.5}),MA=mat(0x3b2a26,{roughness:.4}),MI=mat(0xcfd8dc,{metalness:.8,roughness:.1}),AM=mat(0xc89b3c,{roughness:.4}),CON=mat(0x6b6b70,{roughness:.9});
plane(W,2.5,R.floor,0,0,AX,0,-Math.PI/2);
plane(W,RH,R.wall,0,RH/2,Z0,0);plane(2.5,RH,R.wall,-W/2,RH/2,AX,Math.PI/2);plane(2.5,RH,R.wall,W/2,RH/2,AX,-Math.PI/2);
// 玄関ドア（突き当たり右）と土間
box(1,2.1,.03,R.black,1.2,1.05,Z0+.015,I);plane(.84,2.02,R.door,1.2,1.01,Z0+.035,0);plane(1.2,.8,CON,1.2,.005,Z0+.4,0,-Math.PI/2);
// 仕切り壁（開くと低くなる）：浴室・トイレの手前の壁と、浴室/トイレ間・トイレ右の壁
box(.3,RH,.06,R.wall,-1.65,RH/2,-4.6,bAW);box(.3,RH,.06,R.wall,-.75,RH/2,-4.6,bAW);box(.6,RH,.06,R.wall,.3,RH/2,-4.6,bAW);
box(.06,RH,1.4,R.wall,-.6,RH/2,-5.3,bAW);box(.06,RH,1.4,R.wall,.6,RH/2,-5.3,bAW);
const dl=new THREE.Mesh(new THREE.PlaneGeometry(.6,1.95),new THREE.MeshStandardMaterial({color:0x8b887c,side:THREE.DoubleSide}));dl.position.set(-1.2,.98,-4.575);bAW.add(dl);
const dt=new THREE.Mesh(new THREE.PlaneGeometry(.6,1.95),new THREE.MeshStandardMaterial({color:0xece8dd,side:THREE.DoubleSide}));dt.position.set(-.3,.98,-4.575);bAW.add(dt);
// 浴室（タイプAと同じ：浴槽・石目パネル・鏡・シャワー・シャンプー）
plane(1.2,1.4,BA,-1.2,.004,-5.3,0,-Math.PI/2);plane(1.4,RH,MA,-W/2+.004,RH/2,-5.3,Math.PI/2);
box(1.14,.55,.7,BA,-1.2,.275,-5.62,I);box(1.02,.02,.58,R.sheet,-1.2,.56,-5.62,I);
box(.1,.05,.12,R.steel,-1.74,.85,-5.62,I);cyl(.03,.12,R.white,-1.74,1.5,-5.0);
plane(.5,.9,MI,-W/2+.012,1.3,-4.8,Math.PI/2);box(.06,.03,.8,R.sheet,-1.76,.95,-5.2,I);
for(let i=0;i<3;i++)cyl(.025,.14,AM,-1.75,1.03,-5.45+i*.07);
box(1.14,.03,.03,R.steel,-1.2,2,-5.0,I);
// トイレ（右の壁は木目、トイレットペーパーホルダー、小窓）
plane(1.4,RH,R.wood,.6-.004,RH/2,-5.3,-Math.PI/2);
box(.2,.42,.4,R.white,.45,.63,-5.35,I);box(.58,.14,.38,R.white,.15,.4,-5.35,I);box(.5,.04,.34,R.white,.13,.49,-5.35,I);cyl(.1,.4,R.white,.15,.2,-5.35);cyl(.05,.12,R.white,.45,.9,-5.35);
box(.16,.1,.1,R.white,-.15,.95,Z0+.06,I);plane(.5,.3,mat(0xcfe0e8,{roughness:.3}),-.1,1.85,Z0+.005,0);
// 洗面台（左壁・ミラーキャビネット付き）と洗濯機（防水パン付き）
box(.45,.8,.6,DARK,-1.55,.4,-4.05,I);box(.5,.04,.65,R.white,-1.55,.82,-4.05,I);cyl(.2,.1,R.white,-1.55,.9,-4.05);
box(.04,.25,.04,R.steel,-1.7,.95,-4.05,I);box(.12,.03,.03,R.steel,-1.64,1.07,-4.05,I);
box(.2,.7,.5,DARK,-1.68,1.6,-4.05,I);plane(.5,.65,MI,-1.575,1.6,-4.05,Math.PI/2);box(.04,.12,.18,R.steel,-1.77,1.3,-3.7,I);
box(.62,.05,.65,R.white,.32,.025,-4.3,I);box(.5,.88,.55,R.white,.32,.49,-4.3,I);box(.4,.02,.4,R.black,.32,.935,-4.3,I);box(.4,.04,.1,R.sheet,.32,.94,-4.05,I);}
// ベッド2台（頭側をアクセント壁に付ける）：手前がダブル、奥がもう1台。紫のベッドランナー
const bed=(z,w)=>{box(2,.28,w,R.white,-.8,.14,z,I);box(1.98,.2,w-.02,R.sheet,-.8,.38,z,I);box(.5,.205,w-.01,PUR,-.45,.385,z,I);
 box(.38,.12,.55,R.white,-1.55,.54,z-w/4,I);box(.38,.12,.55,R.white,-1.55,.54,z+w/4,I)};
bed(1.6,1.4);bed(-.6,1.1);
box(.7,.08,.5,R.white,.15,.5,-.6,I);
// ベッド間：丸テーブル・椅子・スツール
cyl(.3,.04,CH,0,.7,.45);cyl(.03,.7,R.black,0,.35,.45);cyl(.22,.03,R.black,0,.02,.45);
box(.45,.06,.45,R.black,-.62,.45,.45,I);box(.04,.5,.45,R.black,-.83,.7,.45,I);box(.04,.45,.04,CH,-.42,.22,.25,I);box(.04,.45,.04,CH,-.42,.22,.65,I);box(.04,.45,.04,CH,-.82,.22,.25,I);box(.04,.45,.04,CH,-.82,.22,.65,I);
box(.4,.04,.4,R.black,.5,.45,.95,I);[[.32,.75],[.68,.75],[.32,1.15],[.68,1.15]].forEach(([x,z])=>box(.04,.43,.04,CH,x,.22,z,I));
// 対面キッチン：入口(x≈1.2,z=-3.5)のすぐ右手(x-)。カウンターは奥壁から部屋の長手方向(z)に伸び、入口側(x+)に正面を向けた流し台と木のレール、上に黒いレンジフード
// その後ろ(奥)＝グレー壁と奥壁の角に冷蔵庫・電子レンジ・ケトル。reference/タイプBベッド.jpg・タイプBキッチン (1).jpg・タイプB冷蔵庫と電子レンジ.jpg 準拠
const RAIL=mat(0xd9a15a),HOODW=mat(0x6e4a32);
box(.6,.85,1.2,DARK,.25,.425,-2.9,I);box(.62,.04,1.22,R.steel,.25,.87,-2.9,I);
box(.4,.03,.46,mat(0x9aa0a6,{metalness:.6,roughness:.4}),.1,.895,-3.2,I);cyl(.11,.02,R.white,.1,.91,-3.2);
box(.34,.04,.42,R.black,.1,.885,-2.6,I);box(.05,.17,.05,R.steel,0,1.0,-2.6,I);
plane(1.2,.5,R.steel,-.03,1.15,-2.9,Math.PI/2);
box(.5,.15,1.1,R.black,.1,1.8,-2.9,I);box(.4,.5,.4,R.black,.1,2.15,-2.9,I);box(.5,.55,.3,HOODW,.1,2.1,-3.35,I);
box(.05,.18,1.2,R.white,.55,.96,-2.9,I);box(.09,.03,1.24,RAIL,.55,1.06,-2.9,I);box(.09,.2,.04,R.black,.55,.9,-3.35,I);box(.09,.2,.04,R.black,.55,.9,-2.45,I);
box(.55,1,.55,R.black,-W/2+.32,.5,-D/2+.32,I);box(.45,.28,.35,R.white,-W/2+.32,1.14,-D/2+.32,I);cyl(.07,.2,PINK,-W/2+.32,1.38,-D/2+.32);
cyl(.13,.3,R.black,1.7,.15,-3.2);
// 壁付け照明・窓・カーテン
box(.1,.2,.2,R.lamp,-W/2+.05,1.55,1.6,I);box(.1,.2,.2,R.lamp,-W/2+.05,1.55,-.6,I);
box(.03,.35,.35,R.white,-W/2+.02,1.4,-1.3,I);
plane(2,1.9,mat(0x1b2230,{roughness:.3}),-.35,1.05,D/2-.01,Math.PI);box(.85,.28,.22,R.white,-.35,2.1,D/2-.11,I);box(.04,.5,.9,R.black,W/2-.03,1.3,1.5,I);box(.1,.2,.2,R.lamp,W/2-.05,1.6,.6,I);box(.4,.08,.3,R.white,-.3,.5,1.5,I);
for(let i=0;i<14;i++)box(.17,2.15,.08,R.curtain,-1.5+i*.17,1.125,D/2-.08+(i%2?.03:0),I);}
tgt=inner;
let inRoom=false;
let rxT=null,distT=null,focusT=0,focus=0;
function setDoorB(o){bOpen=o;if(o){ryT=.15;rxT=.8;distT=.7;focusT=1}else{ryT=.5;rxT=.6;distT=1;focusT=0}}
function resetB(){bOpen=false;bLeaf.position.x=1.2;bPart.scale.y=1;bAW.scale.y=1}
function setDoor(o){doorOpen=o;bathCeil.visible=!o;if(o){ryT=-Math.PI/2;rxT=.45;distT=.6;focusT=1}else{ryT=.5;rxT=.6;distT=1;focusT=0}}
function enterRoomView(id){if(!id||!hasInterior(id))return;curType=roomType(id);inRoom=true;ry=.5;rx=.6;dist=1;ryT=null;rxT=distT=null;doorOpen=false;resetB();bathCeil.visible=true;doorPivot.rotation.y=0;frontWalls.scale.y=1;focus=focusT=0;exitRoomBtn.style.display='inline-block'}
function exitRoomView(){if(!inRoom)return;inRoom=false;ry=-.55;rx=.12;dist=1;ryT=null;rxT=distT=null;doorOpen=false;resetB();bathCeil.visible=true;doorPivot.rotation.y=0;frontWalls.scale.y=1;focus=focusT=0;exitRoomBtn.style.display='none'}
const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();
let drag=false,px=0,py=0,sx=0,sy=0,ry=-.55,rx=.12,dist=1,ryT=null;
const pts=new Map();let pinch0=0,dist0=1;
const pinchLen=()=>{let [a,b]=[...pts.values()];return Math.hypot(a.x-b.x,a.y-b.y)};
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});ryT=null;rxT=distT=null;
 if(pts.size===1){drag=true;px=sx=e.clientX;py=sy=e.clientY}else{drag=false;pinch0=pinchLen();dist0=dist}});
canvas.addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pts.size>=2){if(pinch0)dist=Math.max(.55,Math.min(2.1,dist0*pinch0/pinchLen()));return}
 if(drag){ry+=(e.clientX-px)*.008;rx+=(e.clientY-py)*.005;rx=Math.max(-.5,Math.min(.7,rx));px=e.clientX;py=e.clientY}});
function endPointer(e,cancel){if(!pts.has(e.pointerId))return;pts.delete(e.pointerId);
 if(!cancel&&drag&&Math.hypot(e.clientX-sx,e.clientY-sy)<8)pick(e);
 drag=false;if(pts.size<2)pinch0=0}
canvas.addEventListener('pointerup',e=>endPointer(e,false));
canvas.addEventListener('pointercancel',e=>endPointer(e,true));
canvas.addEventListener('wheel',e=>{e.preventDefault();rxT=distT=null;dist=Math.max(.55,Math.min(2.1,dist+e.deltaY*.001))},{passive:false});
function pick(e){let r=canvas.getBoundingClientRect();mouse.x=((e.clientX-r.left)/r.width)*2-1;mouse.y=-((e.clientY-r.top)/r.height)*2+1;ray.setFromCamera(mouse,camera);
 if(inRoom){if(curType==='A'&&ray.intersectObjects(doorHits)[0])setDoor(!doorOpen);if(curType==='B'&&ray.intersectObjects([bLeaf])[0])setDoorB(!bOpen);return}
 const vis=o=>{for(;o;o=o.parent)if(!o.visible)return false;return true};
 let hit=ray.intersectObjects([...rooms,...commons].filter(vis))[0];if(!hit)return;let o=hit.object;
 if(o.userData.area){onPickLocation('common',o.userData.area);return}
 while(!o.userData.id)o=o.parent;onPickLocation('room',o.userData.id)}
let picked=null;
function highlight(sel){picked=sel||null;rooms.forEach(x=>x.material.emissive.setHex(picked&&picked.type==='room'&&x.userData.id===picked.loc?0x35557f:0))}
function applyFloor(){let f=floorSel.value;floors.forEach(g=>g.visible=f==='all'||String(g.userData.floor)===f)}
function explode(){exploded=!exploded}
function floorOptions(){return FLOORS.slice().reverse().map(f=>({value:String(f),label:f+'F'}))}
function resetView(){exitRoomView();ry=-.55;rx=.12;dist=1;floorSel.value='all';applyFloor()}
function resize(){let w=canvas.clientWidth,h=canvas.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
function loop(){resize();if(ryT!==null){let d=ryT-ry;ry+=d*.1;if(Math.abs(d)<.003){ry=ryT;ryT=null}}if(rxT!==null)rx+=(rxT-rx)*.08;if(distT!==null)dist+=(distT-dist)*.08;focus+=(focusT-focus)*.08;doorPivot.rotation.y+=((doorOpen?Math.PI/2:0)-doorPivot.rotation.y)*.12;frontWalls.scale.y+=((doorOpen?.12:1)-frontWalls.scale.y)*.1;inner.position.set(.35*focus,-RH/2,2.4*focus);innerB.position.set(0,-RH/2,4.2*focus);bPart.scale.y+=((bOpen?.12:1)-bPart.scale.y)*.1;bAW.scale.y+=((bOpen?.3:1)-bAW.scale.y)*.1;bLeaf.position.x+=((bOpen?.36:1.2)-bLeaf.position.x)*.12;building.visible=!inRoom;roomView.visible=inRoom&&curType==='A';roomViewB.visible=inRoom&&curType==='B';building.rotation.y=roomView.rotation.y=roomViewB.rotation.y=ry;building.rotation.x=roomView.rotation.x=roomViewB.rotation.x=rx;let fit=Math.max(1,1.08/camera.aspect);camera.position.set(0,7*fit,21.5*dist*fit);camera.lookAt(0,3,0);floors.forEach(g=>{let t=g.userData.baseY+(exploded?g.userData.idx*LIFT:0);g.position.y+=(t-g.position.y)*.08});renderer.render(scene,camera);requestAnimationFrame(loop)}
