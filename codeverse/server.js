<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Advanced Video Call</title>
<style>
body{margin:0;font-family:sans-serif;background:#111;color:white;display:flex;flex-direction:column;align-items:center;}
#controls{margin-top:10px;}
#videos{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;width:90%;margin-top:10px;}
video{width:100%;background:#000;border-radius:8px;}
button,input{padding:6px 12px;margin:5px;border-radius:6px;border:none;font-weight:bold;}
button{cursor:pointer;background:#0f0;color:#000;}
.name-label{position:absolute;color:white;font-size:14px;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:4px;}
.video-container{position:relative;}
</style>
</head>
<body>
<h2>Advanced Multi-User Video Call</h2>
<div id="controls">
<input type="text" id="roomId" placeholder="Room ID">
<input type="text" id="userName" placeholder="Your Name">
<button id="joinBtn">Join Room</button>
<button id="muteAudioBtn">Mute Audio</button>
<button id="muteVideoBtn">Hide Video</button>
<button id="shareScreenBtn">Share Screen</button>
</div>
<div id="videos"></div>

<script>
const ws = new WebSocket(`ws://${location.host}`);
const joinBtn = document.getElementById('joinBtn');
const roomIdInput = document.getElementById('roomId');
const userNameInput = document.getElementById('userName');
const videosDiv = document.getElementById('videos');
const muteAudioBtn = document.getElementById('muteAudioBtn');
const muteVideoBtn = document.getElementById('muteVideoBtn');
const shareScreenBtn = document.getElementById('shareScreenBtn');

let localStream, audioMuted=false, videoMuted=false;
const pcs = {};
const remoteVideos = {};

async function initLocalStream(){
  localStream = await navigator.mediaDevices.getUserMedia({video:true,audio:true});
  addVideo(localStream,'You');
}

function addVideo(stream,name,id){
  const container = document.createElement('div');
  container.className='video-container';
  const video = document.createElement('video');
  video.autoplay=true;
  video.srcObject = stream;
  if(id===undefined) video.muted=true;
  const label = document.createElement('div');
  label.className='name-label';
  label.textContent=name;
  container.appendChild(video);
  container.appendChild(label);
  videosDiv.appendChild(container);
  if(id!==undefined) remoteVideos[id]=container;
}

joinBtn.onclick = async ()=>{
  const roomId = roomIdInput.value.trim();
  const name = userNameInput.value.trim() || 'Anonymous';
  if(!roomId) return alert('Enter Room ID');
  joinBtn.disabled = true;
  await initLocalStream();
  ws.send(JSON.stringify({type:'join',room:roomId,name}));
};

// handle signaling
ws.onmessage = async msg=>{
  const data = JSON.parse(msg.data);

  if(data.type==='existing'){
    for(const c of data.clients){
      await createOffer(c.id,c.name);
    }
  }

  if(data.type==='new-user'){
    createPeerConnection(data.id,data.name);
  }

  if(data.type==='offer'){
    const pc = createPeerConnection(data.sender,data.name||`User${data.sender}`);
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({type:'answer',sdp:answer,target:data.sender}));
  }

  if(data.type==='answer'){
    const pc = pcs[data.sender];
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  }

  if(data.type==='ice'){
    const pc = pcs[data.sender];
    try{ await pc.addIceCandidate(data.candidate); } catch(e){console.error(e);}
  }

  if(data.type==='leave'){
    if(remoteVideos[data.id]){
      videosDiv.removeChild(remoteVideos[data.id]);
      delete remoteVideos[data.id];
      if(pcs[data.id]) pcs[data.id].close();
      delete pcs[data.id];
    }
  }
};

function createPeerConnection(id,name){
  if(pcs[id]) return pcs[id];
  const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
  pc.ontrack = event => {
    if(!remoteVideos[id]) addVideo(event.streams[0],name,id);
  };
  pc.onicecandidate = event => {
    if(event.candidate) ws.send(JSON.stringify({type:'ice',candidate:event.candidate,target:id}));
  };
  pcs[id] = pc;
  return pc;
}

async function createOffer(id,name){
  const pc = createPeerConnection(id,name);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({type:'offer',sdp:offer,target:id}));
}

// Mute/Unmute Audio
muteAudioBtn.onclick = () => {
  audioMuted = !audioMuted;
  localStream.getAudioTracks()[0].enabled = !audioMuted;
  muteAudioBtn.textContent = audioMuted?'Unmute Audio':'Mute Audio';
};

// Hide/Show Video
muteVideoBtn.onclick = () => {
  videoMuted = !videoMuted;
  localStream.getVideoTracks()[0].enabled = !videoMuted;
  muteVideoBtn.textContent = videoMuted?'Show Video':'Hide Video';
};

// Screen Share
shareScreenBtn.onclick = async () => {
  // Step 1: Show message to user
  shareScreenBtn.disabled = true;
  muteAudioBtn.disabled = true;
  muteVideoBtn.disabled = true;
  joinBtn.disabled = true;
  alert('Please select the screen or window to share. After selection, your video will be replaced by the shared screen.');

  try {
    // Step 2: Get screen stream
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

    const screenTrack = screenStream.getVideoTracks()[0];

    // Step 3: Replace video track in all peer connections
    for (const id in pcs) {
      const sender = pcs[id].getSenders().find(s => s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    }

    // Step 4: Update local video to show screen
    localStream.getVideoTracks()[0].enabled = false; // hide local camera
    const oldStream = localStream;
    localStream = new MediaStream([...oldStream.getAudioTracks(), screenTrack]);
    remoteVideos['local'] && (remoteVideos['local'].querySelector('video').srcObject = localStream);

    // Step 5: When screen sharing ends, restore camera
    screenTrack.onended = () => {
      localStream = new MediaStream([...oldStream.getTracks()]);
      for (const id in pcs) {
        const sender = pcs[id].getSenders().find(s => s.track.kind === 'video');
        if (sender) sender.replaceTrack(oldStream.getVideoTracks()[0]);
      }
      remoteVideos['local'] && (remoteVideos['local'].querySelector('video').srcObject = localStream);

      // Re-enable buttons
      shareScreenBtn.disabled = false;
      muteAudioBtn.disabled = false;
      muteVideoBtn.disabled = false;
      joinBtn.disabled = true; // still joined
    };
  } catch (err) {
    console.error('Screen share canceled or failed:', err);
    // Re-enable buttons
    shareScreenBtn.disabled = false;
    muteAudioBtn.disabled = false;
    muteVideoBtn.disabled = false;
    joinBtn.disabled = true; // still joined
  }
};

</script>
</body>
</html>
