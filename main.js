const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

// Game state
const gameState = {
  myPlayerId: null,
  players: {},
  avatars: {},
  worldImage: null,
  viewport: { x: 0, y: 0, width: 0, height: 0 }
};

// WebSocket connection
let ws = null;

// Input tracking
const pressedKeys = {};
const movementKeys = {
  'ArrowUp': 'up', 'w': 'up', 'W': 'up',
  'ArrowDown': 'down', 's': 'down', 'S': 'down', 
  'ArrowLeft': 'left', 'a': 'left', 'A': 'left',
  'ArrowRight': 'right', 'd': 'right', 'D': 'right'
};

// Movement loop
let movementInterval = null;
const MOVEMENT_INTERVAL = 150; // Send movement commands every 150ms (6.7 FPS) - less frequent to reduce lag
let lastMovementTime = 0;

// Movement prediction
const movementPrediction = {
  enabled: false, // Disable movement prediction to prevent teleporting
  lastUpdateTime: 0,
  predictedPosition: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 }
};

// Camera smoothing
const cameraSmoothing = {
  enabled: false, // Disable camera smoothing to prevent teleporting
  targetX: 0,
  targetY: 0,
  currentX: 0,
  currentY: 0,
  speed: 0.15
};

// Visual effects
const visualEffects = {
  movementTrails: [],
  maxTrailLength: 10 // Reduced for better performance
};

// Initialize game
function initGame() {
  // Load world image
  gameState.worldImage = new Image();
  gameState.worldImage.src = 'world.jpg';
  gameState.worldImage.addEventListener('load', () => {
    setupCanvas();
    connectToServer();
  });
  
  // Handle window resize
  window.addEventListener('resize', setupCanvas);
  
  // Handle keyboard input
  setupKeyboardInput();
}

function setupCanvas() {
  // Match canvas pixel buffer to CSS size to avoid implicit scaling
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  // Update viewport dimensions
  gameState.viewport.width = canvas.width;
  gameState.viewport.height = canvas.height;
  
  draw();
}

function connectToServer() {
  ws = new WebSocket('wss://codepath-mmorg.onrender.com');
  
  ws.onopen = () => {
    console.log('Connected to game server');
    // Send join game message
    const joinMessage = {
      action: 'join_game',
      username: 'Tim'
    };
    ws.send(JSON.stringify(joinMessage));
  };
  
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleServerMessage(message);
    } catch (error) {
      console.error('Error parsing server message:', error);
    }
  };
  
  ws.onclose = () => {
    console.log('Disconnected from game server');
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function handleServerMessage(message) {
  switch (message.action) {
    case 'join_game':
      if (message.success) {
        gameState.myPlayerId = message.playerId;
        gameState.players = message.players;
        gameState.avatars = message.avatars;
        
        // Pre-load avatar images
        preloadAvatarImages();
        
        // Center viewport on my avatar
        centerViewportOnMyAvatar();
        
        console.log('Joined game successfully:', message);
      } else {
        console.error('Failed to join game:', message.error);
      }
      break;
      
    case 'player_joined':
      gameState.players[message.player.id] = message.player;
      if (message.avatar) {
        gameState.avatars[message.avatar.name] = message.avatar;
        preloadAvatarImages();
      }
      break;
      
    case 'players_moved':
      Object.assign(gameState.players, message.players);
      
      // Update viewport if my avatar moved - but only if we're not currently moving
      if (message.players[gameState.myPlayerId]) {
        const myPlayer = message.players[gameState.myPlayerId];
        const isCurrentlyMoving = Object.keys(pressedKeys).some(k => pressedKeys[k]);
        
        // Only update viewport if we're not actively moving (to prevent camera jumping)
        if (!isCurrentlyMoving) {
          centerViewportOnMyAvatar();
        }
      }
      
      // Update movement prediction
      updateMovementPrediction();
      break;
      
    case 'player_left':
      delete gameState.players[message.playerId];
      break;
      
    default:
      console.log('Unknown message:', message);
  }
}

function preloadAvatarImages() {
  Object.values(gameState.avatars).forEach(avatar => {
    Object.values(avatar.frames).forEach(frameArray => {
      frameArray.forEach((base64Data, index) => {
        if (typeof base64Data === 'string' && base64Data.startsWith('data:')) {
          const img = new Image();
          img.src = base64Data;
          // Store reference for efficient rendering
          frameArray[index] = img;
        }
      });
    });
  });
}

function centerViewportOnMyAvatar() {
  if (!gameState.myPlayerId || !gameState.players[gameState.myPlayerId]) return;
  
  const myPlayer = gameState.players[gameState.myPlayerId];
  const worldWidth = 2048;
  const worldHeight = 2048;
  
  // Calculate target viewport position
  const targetX = myPlayer.x - gameState.viewport.width / 2;
  const targetY = myPlayer.y - gameState.viewport.height / 2;
  
  // Clamp to world boundaries
  const clampedX = Math.max(0, Math.min(targetX, worldWidth - gameState.viewport.width));
  const clampedY = Math.max(0, Math.min(targetY, worldHeight - gameState.viewport.height));
  
  // Always use instant camera movement to prevent teleporting
  gameState.viewport.x = clampedX;
  gameState.viewport.y = clampedY;
}

function updateCameraSmoothing() {
  if (!cameraSmoothing.enabled) return;
  
  // Smooth interpolation towards target
  const dx = cameraSmoothing.targetX - cameraSmoothing.currentX;
  const dy = cameraSmoothing.targetY - cameraSmoothing.currentY;
  
  cameraSmoothing.currentX += dx * cameraSmoothing.speed;
  cameraSmoothing.currentY += dy * cameraSmoothing.speed;
  
  // Update viewport
  gameState.viewport.x = cameraSmoothing.currentX;
  gameState.viewport.y = cameraSmoothing.currentY;
}

function draw() {
  if (!gameState.worldImage || !gameState.worldImage.complete) return;
  
  // Clear the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw the world map with viewport offset
  ctx.drawImage(
    gameState.worldImage,
    gameState.viewport.x, gameState.viewport.y, gameState.viewport.width, gameState.viewport.height,
    0, 0, canvas.width, canvas.height
  );
  
  // Draw movement trails
  drawMovementTrails();
  
  // Draw all players
  drawPlayers();
  
  // Draw UI elements
  drawUI();
}

function drawPlayers() {
  Object.values(gameState.players).forEach(player => {
    drawPlayer(player);
  });
}

function drawPlayer(player) {
  const avatar = gameState.avatars[player.avatar];
  if (!avatar) return;
  
  // Calculate screen position relative to viewport
  const screenX = player.x - gameState.viewport.x;
  const screenY = player.y - gameState.viewport.y;
  
  // Skip if player is outside viewport
  if (screenX < -50 || screenX > canvas.width + 50 || 
      screenY < -50 || screenY > canvas.height + 50) {
    return;
  }
  
  // Add movement trail for my avatar
  if (player.id === gameState.myPlayerId && player.isMoving) {
    addMovementTrail(screenX, screenY);
  }
  
  // Get the appropriate frame
  let frameImage;
  if (player.facing === 'west') {
    // West uses flipped east frames
    const eastFrames = avatar.frames.east;
    frameImage = eastFrames[player.animationFrame];
  } else {
    const directionFrames = avatar.frames[player.facing];
    frameImage = directionFrames[player.animationFrame];
  }
  
  if (!frameImage || !frameImage.complete) return;
  
  // Calculate avatar size (maintain aspect ratio)
  const avatarSize = 64; // Base size
  const aspectRatio = frameImage.width / frameImage.height;
  const width = avatarSize;
  const height = avatarSize / aspectRatio;
  
  // Draw avatar with subtle shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  
  if (player.facing === 'west') {
    // Flip horizontally for west direction
    ctx.scale(-1, 1);
    ctx.drawImage(frameImage, -screenX - width/2, screenY - height/2, width, height);
  } else {
    ctx.drawImage(frameImage, screenX - width/2, screenY - height/2, width, height);
  }
  
  ctx.restore();
  
  // Draw username label with better styling
  drawPlayerLabel(player.username, screenX, screenY - height/2 - 10, player.id === gameState.myPlayerId);
}

function drawPlayerLabel(username, x, y, isMyPlayer = false) {
  ctx.save();
  
  // Different styling for my player
  if (isMyPlayer) {
    ctx.fillStyle = 'rgba(0, 100, 200, 0.8)';
    ctx.fillRect(x - 35, y - 18, 70, 24);
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 13px Arial';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(x - 30, y - 15, 60, 20);
    
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
  }
  
  ctx.textAlign = 'center';
  ctx.fillText(username, x, y - 2);
  
  if (isMyPlayer) {
    ctx.strokeText(username, x, y - 2);
  }
  
  ctx.restore();
}

function addMovementTrail(x, y) {
  const now = Date.now();
  visualEffects.movementTrails.push({
    x: x,
    y: y,
    time: now,
    alpha: 1.0
  });
  
  // Limit trail length
  if (visualEffects.movementTrails.length > visualEffects.maxTrailLength) {
    visualEffects.movementTrails.shift();
  }
}

function drawMovementTrails() {
  const now = Date.now();
  const trailLifetime = 500; // Reduced to 0.5 seconds for better performance
  
  ctx.save();
  
  // Only draw trails if there are any
  if (visualEffects.movementTrails.length > 0) {
    visualEffects.movementTrails.forEach((trail, index) => {
      const age = now - trail.time;
      const alpha = Math.max(0, 1 - (age / trailLifetime));
      
      if (alpha > 0) {
        ctx.globalAlpha = alpha * 0.4; // Reduced opacity for better performance
        ctx.fillStyle = '#4A90E2';
        ctx.beginPath();
        ctx.arc(trail.x, trail.y, 2, 0, Math.PI * 2); // Smaller particles
        ctx.fill();
      }
    });
    
    // Remove old trails
    visualEffects.movementTrails = visualEffects.movementTrails.filter(
      trail => (now - trail.time) < trailLifetime
    );
  }
  
  ctx.restore();
}

function drawUI() {
  // Connection status
  ctx.save();
  ctx.fillStyle = ws && ws.readyState === WebSocket.OPEN ? '#4CAF50' : '#F44336';
  ctx.fillRect(10, 10, 12, 12);
  
  ctx.fillStyle = 'white';
  ctx.font = '12px Arial';
  ctx.fillText(ws && ws.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected', 30, 20);
  
  // Player count
  const playerCount = Object.keys(gameState.players).length;
  ctx.fillText(`Players: ${playerCount}`, 10, 40);
  
  // Movement instructions
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillText('Use WASD or Arrow Keys to move', 10, canvas.height - 20);
  
  ctx.restore();
}

function updateMovementPrediction() {
  if (!movementPrediction.enabled || !gameState.myPlayerId) return;
  
  const myPlayer = gameState.players[gameState.myPlayerId];
  if (!myPlayer) return;
  
  const now = Date.now();
  const deltaTime = now - movementPrediction.lastUpdateTime;
  
  if (deltaTime > 0) {
    // Calculate velocity based on position change
    const dx = myPlayer.x - movementPrediction.predictedPosition.x;
    const dy = myPlayer.y - movementPrediction.predictedPosition.y;
    
    movementPrediction.velocity.x = dx / deltaTime;
    movementPrediction.velocity.y = dy / deltaTime;
    
    // Update predicted position
    movementPrediction.predictedPosition.x = myPlayer.x;
    movementPrediction.predictedPosition.y = myPlayer.y;
  }
  
  movementPrediction.lastUpdateTime = now;
}

function setupKeyboardInput() {
  document.addEventListener('keydown', (event) => {
    const key = event.key;
    
    // Handle movement keys (arrow keys + WASD)
    if (movementKeys[key]) {
      event.preventDefault(); // Prevent page scrolling
      
      // If this key wasn't already pressed, start movement
      if (!pressedKeys[key]) {
        pressedKeys[key] = true;
        startMovementLoop();
      }
    }
  });
  
  document.addEventListener('keyup', (event) => {
    const key = event.key;
    
    if (movementKeys[key]) {
      pressedKeys[key] = false;
      
      // Check if any movement keys are still pressed
      const hasMovementKeys = Object.keys(pressedKeys).some(k => pressedKeys[k]);
      
      if (!hasMovementKeys) {
        stopMovementLoop();
        sendStopCommand();
      }
    }
  });
}

function startMovementLoop() {
  // Only start if not already running
  if (movementInterval) return;
  
  // Send initial movement command immediately
  sendMovementCommand();
  lastMovementTime = Date.now();
  
  // Start continuous movement loop with throttling
  movementInterval = setInterval(() => {
    const now = Date.now();
    if (now - lastMovementTime >= MOVEMENT_INTERVAL) {
      sendMovementCommand();
      lastMovementTime = now;
    }
  }, 50); // Check every 50ms but only send every 150ms
}

function stopMovementLoop() {
  if (movementInterval) {
    clearInterval(movementInterval);
    movementInterval = null;
  }
}

function sendMovementCommand() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  // Calculate movement direction from pressed keys
  const directions = [];
  Object.keys(pressedKeys).forEach(key => {
    if (pressedKeys[key] && movementKeys[key]) {
      directions.push(movementKeys[key]);
    }
  });
  
  if (directions.length === 0) return;
  
  // For diagonal movement, prioritize one direction to avoid teleporting
  if (directions.length > 1) {
    // Prioritize horizontal movement for diagonal
    const primaryDirection = getPrimaryDirection(directions);
    sendMoveCommand(primaryDirection);
  } else {
    sendMoveCommand(directions[0]);
  }
}

function getPrimaryDirection(directions) {
  // Prioritize horizontal movement for diagonal
  if (directions.includes('left') || directions.includes('right')) {
    return directions.find(d => d === 'left' || d === 'right');
  }
  return directions[0];
}

function sendMoveCommand(direction) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  const moveMessage = {
    action: 'move',
    direction: direction
  };
  ws.send(JSON.stringify(moveMessage));
}

function sendStopCommand() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  const stopMessage = {
    action: 'stop'
  };
  ws.send(JSON.stringify(stopMessage));
}

// Animation loop
function gameLoop() {
  draw();
  requestAnimationFrame(gameLoop);
}

// Start the game
initGame();
gameLoop();


