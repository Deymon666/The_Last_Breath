import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import IntroCinematic from './IntroCinematic';

// --- Constants ---
let CANVAS_WIDTH = window.innerWidth;
let CANVAS_HEIGHT = window.innerHeight;
let ROAD_WIDTH = Math.min(600, CANVAS_WIDTH * 0.8);
let ROAD_LEFT = (CANVAS_WIDTH - ROAD_WIDTH) / 2;
let ROAD_RIGHT = ROAD_LEFT + ROAD_WIDTH;

const getRoadBounds = (y: number) => {
  const baseWidth = ROAD_WIDTH;
  // Width variation between ~0.7x and 1.3x
  const widthVariation = Math.sin(y * 0.001) * 0.2 + Math.sin(y * 0.0025) * 0.1;
  const currentWidth = baseWidth * (1 + widthVariation);
  
  // Horizontal shifting
  const shift = Math.sin(y * 0.0015) * (baseWidth * 0.2) + Math.sin(y * 0.0007) * (baseWidth * 0.1);
  const center = CANVAS_WIDTH / 2 + shift;
  
  return {
    left: center - currentWidth / 2,
    right: center + currentWidth / 2,
    width: currentWidth
  };
};
const PLAYER_SIZE = 20;
const LEVEL_LENGTH = 50000; // Total distance to travel
const MAX_FUEL = 100;
const FUEL_CONSUMPTION = 0.05;
const ENEMY_SPAWN_RATE = 0.02;
const FOX_SPAWN_RATE = 0.005;
const BLOOD_SPAWN_RATE = 0.01;

// --- Types ---
type GameState = 'TITLE' | 'INTRO' | 'MENU' | 'PLAYING' | 'GAME_OVER' | 'VICTORY' | 'PAUSED';

interface Entity {
  id: number;
  type: 'enemy' | 'fox' | 'blood' | 'rock';
  behavior?: 'static' | 'vertical' | 'lateral'; // New behavior field
  x: number;
  y: number;
  width: number;
  height: number;
  speedX: number;
  speedY: number; // Relative to world
  color: string;
  stunTimer?: number; // For boss
  lateralPhase?: number; // For lateral movement math
}

interface Player {
  x: number;
  y: number; // World Y position
  speed: number; // Downward speed
  maxSpeed: number;
  fuel: number;
  isCursed: boolean;
  curseTimer: number;
  invulnerable: boolean;
  lives: number;
  respawnTimer: number;
  // Attack
  attackState: 'IDLE' | 'EXTENDING' | 'RETRACTING';
  chainLength: number;
  chainMaxLength: number;
  chainCooldown: number;
  introYOffset: number;
}

// --- Helper Functions ---

// Draw an "ink stroke" style rectangle
function drawInkRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  // Rough edges
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.fill();
  
  // Add some "splatter" or roughness
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y + Math.random() * 2);
  ctx.lineTo(x + w - Math.random() * 2, y + h);
  ctx.lineTo(x, y + h - Math.random() * 2);
  ctx.closePath();
  ctx.stroke();
}

function drawInkCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, blur: number = 0) {
  ctx.fillStyle = color;
  if (blur > 0) {
    ctx.shadowBlur = blur;
    ctx.shadowColor = color;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawChain(ctx: CanvasRenderingContext2D, x: number, y: number, length: number) {
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + length);
  ctx.stroke();

  // Links
  const linkSize = 8;
  for (let i = 0; i < length; i += linkSize * 1.5) {
    ctx.strokeRect(x - 3, y + i, 6, linkSize);
  }
  
  // Hook at end
  ctx.beginPath();
  ctx.moveTo(x, y + length);
  ctx.lineTo(x - 5, y + length - 5);
  ctx.moveTo(x, y + length);
  ctx.lineTo(x + 5, y + length - 5);
  ctx.stroke();
}

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('TITLE');
  const [menuView, setMenuView] = useState<'MAIN' | 'CONTROLS' | 'SCORE'>('MAIN');
  const [score, setScore] = useState(0);
  const [finalTime, setFinalTime] = useState(0);
  const [highScore, setHighScore] = useState(0);

  // Load high score on mount
  useEffect(() => {
    const saved = localStorage.getItem('lastbreath_highscore');
    if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  // Save high score when score updates
  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('lastbreath_highscore', score.toString());
    }
  }, [score, highScore]);

  // Auto-transition from TITLE to INTRO
  useEffect(() => {
    if (gameState === 'TITLE') {
      const timer = setTimeout(() => {
        setGameState('INTRO');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [gameState]);

  // Mutable game state
  const state = useRef({
    player: {
      x: getRoadBounds(0).left + getRoadBounds(0).width / 2 - PLAYER_SIZE / 2,
      y: 0,
      speed: 0,
      maxSpeed: 8,
      fuel: MAX_FUEL,
      isCursed: false,
      curseTimer: 0,
      invulnerable: false,
      lives: 3,
      respawnTimer: 0,
      attackState: 'IDLE',
      chainLength: 0,
      chainMaxLength: 220, // Increased range slightly
      chainCooldown: 0,
      introYOffset: -CANVAS_HEIGHT,
    } as Player,
    entities: [] as Entity[],
    keys: {} as Record<string, boolean>,
    mouse: { left: false }, // Add mouse state
    lastTime: 0,
    cameraY: 0,
    gameTime: 0,
    nextEntityId: 0,
    lastSpawnY: 0,
    bossSpawned: false,
    boss: null as Entity | null,
    particles: [] as {x: number, y: number, vx: number, vy: number, life: number, color: string}[],
    killScore: 0,
  });

  // --- Window Resize Handling ---
  useEffect(() => {
    const handleResize = () => {
      CANVAS_WIDTH = window.innerWidth;
      CANVAS_HEIGHT = window.innerHeight;
      ROAD_WIDTH = Math.min(600, CANVAS_WIDTH * 0.8);
      ROAD_LEFT = (CANVAS_WIDTH - ROAD_WIDTH) / 2;
      ROAD_RIGHT = ROAD_LEFT + ROAD_WIDTH;
      
      if (canvasRef.current) {
        canvasRef.current.width = CANVAS_WIDTH;
        canvasRef.current.height = CANVAS_HEIGHT;
      }
    };

    window.addEventListener('resize', handleResize);
    // Initial setup
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Input Handling ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      state.current.keys[e.key.toLowerCase()] = true;
      if (e.key === 'Shift') state.current.keys['shift'] = true;
      if (e.key === ' ') state.current.keys['space'] = true;
      
      if (e.key === 'Enter') {
        if (gameState === 'MENU' || gameState === 'GAME_OVER' || gameState === 'VICTORY') {
          resetGame();
        }
      }
      
      if (e.key === 'p' || e.key === 'Escape') {
        setGameState(prev => {
          if (prev === 'PLAYING') return 'PAUSED';
          if (prev === 'PAUSED') return 'PLAYING';
          return prev;
        });
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      state.current.keys[e.key.toLowerCase()] = false;
      if (e.key === 'Shift') state.current.keys['shift'] = false;
      if (e.key === ' ') state.current.keys['space'] = false;
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) state.current.mouse.left = true;
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) state.current.mouse.left = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [gameState]);

  // --- Game Loop ---
  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    let animationFrameId: number;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const loop = (timestamp: number) => {
      const dt = (timestamp - state.current.lastTime) / 16.67; // Normalize to ~60fps
      state.current.lastTime = timestamp;
      state.current.gameTime += dt;

      update(dt);
      draw(ctx);

      if (gameState === 'PLAYING') {
        animationFrameId = requestAnimationFrame(loop);
      }
    };

    state.current.lastTime = performance.now();
    animationFrameId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState]);

  const resetGame = () => {
    state.current = {
      player: {
        x: getRoadBounds(0).left + getRoadBounds(0).width / 2 - PLAYER_SIZE / 2,
        y: 0,
        speed: 0,
        maxSpeed: 8,
        fuel: MAX_FUEL,
        isCursed: false,
        curseTimer: 0,
        invulnerable: false,
        lives: 3,
        respawnTimer: 0,
        attackState: 'IDLE',
        chainLength: 0,
        chainMaxLength: 220,
        chainCooldown: 0,
        introYOffset: -CANVAS_HEIGHT,
      },
      entities: [],
      keys: {},
      mouse: { left: false },
      lastTime: performance.now(),
      cameraY: 0,
      gameTime: 0,
      nextEntityId: 0,
      lastSpawnY: 0,
      bossSpawned: false,
      boss: null,
      particles: [],
      killScore: 0,
    };
    setScore(0);
    setGameState('PLAYING');
  };

  const spawnParticles = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      state.current.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 30 + Math.random() * 20,
        color
      });
    }
  };

  const update = (dt: number) => {
    const s = state.current;
    const p = s.player;

    // Difficulty Scaling (1.0 to 3.0 based on progress)
    const difficulty = 1 + (p.y / LEVEL_LENGTH) * 2;
    
    // Calculate dynamic spawn distance based on difficulty (closer together as it gets harder)
    const spawnDistance = Math.max(60, 150 - (difficulty * 25));

    // --- Respawn Logic ---
    if (p.respawnTimer > 0) {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        const bounds = getRoadBounds(p.y);
        p.x = bounds.left + bounds.width / 2 - PLAYER_SIZE / 2;
        p.invulnerable = true;
        setTimeout(() => {
            if (state.current.player) state.current.player.invulnerable = false;
        }, 2000);
      } else {
        return;
      }
    }

    // --- Intro Animation ---
    if (p.introYOffset < 0) {
      p.introYOffset += 15 * dt; // Fall speed
      if (p.introYOffset >= 0) {
        p.introYOffset = 0;
      }
      // Don't allow movement or other actions while falling
      s.cameraY = p.y + p.introYOffset - CANVAS_HEIGHT * 0.25;
      return;
    }

    // --- Controls ---
    if (s.keys['s']) {
      p.speed += 0.2 * dt;
    } else if (p.speed < 2) {
      p.speed += 0.05 * dt;
    } else {
      p.speed -= 0.1 * dt;
    }

    const currentMaxSpeed = p.isCursed ? 15 : p.maxSpeed;
    if (p.speed > currentMaxSpeed) p.speed = currentMaxSpeed;
    if (p.speed < 0) p.speed = 0;

    let steerSpeed = 4;
    if (p.isCursed) steerSpeed = 6;
    
    if (s.keys['a']) {
      p.x -= steerSpeed * dt;
    }
    if (s.keys['d']) {
      p.x += steerSpeed * dt;
    }

    // --- Attack Logic ---
    if (p.chainCooldown > 0) p.chainCooldown -= dt;

    // Trigger attack with Shift OR Left Click OR Space
    const isAttacking = s.keys['shift'] || s.mouse.left || s.keys['space'];

    if (isAttacking && p.attackState === 'IDLE' && p.chainCooldown <= 0) {
      p.attackState = 'EXTENDING';
    }

    const attackSpeed = p.isCursed ? 30 : 20;

    if (p.attackState === 'EXTENDING') {
      p.chainLength += attackSpeed * dt;
      if (p.chainLength >= p.chainMaxLength) {
        p.chainLength = p.chainMaxLength;
        p.attackState = 'RETRACTING';
      }
    } else if (p.attackState === 'RETRACTING') {
      p.chainLength -= attackSpeed * dt;
      if (p.chainLength <= 0) {
        p.chainLength = 0;
        p.attackState = 'IDLE';
        p.chainCooldown = 45; // Cooldown frames (~0.75s)
      }
    }

    // --- Movement ---
    p.y += p.speed * dt;
    s.cameraY = p.y - CANVAS_HEIGHT * 0.25;

    // --- Fuel ---
    p.fuel -= FUEL_CONSUMPTION * dt;
    if (p.fuel <= 0) {
      setGameState('GAME_OVER');
    }

    // --- Curse Event ---
    if (p.y > LEVEL_LENGTH * 0.5 && p.y < LEVEL_LENGTH * 0.5 + 2000 && !p.isCursed) {
      p.isCursed = true;
      p.invulnerable = true;
      p.curseTimer = 300;
    }

    if (p.isCursed) {
      p.curseTimer -= dt;
      if (p.curseTimer <= 0) {
        p.isCursed = false;
        p.invulnerable = false;
      }
    }

    // --- Spawning ---
    const spawnY = p.y + CANVAS_HEIGHT + 100;
    
    // Boss Spawn
    if (p.y > LEVEL_LENGTH - 1000 && !s.bossSpawned) {
      s.bossSpawned = true;
      const bounds = getRoadBounds(spawnY);
      s.boss = {
        id: s.nextEntityId++,
        type: 'enemy',
        behavior: 'lateral', // Boss moves laterally
        x: bounds.left + bounds.width / 2 - 60,
        y: spawnY,
        width: 120,
        height: 120,
        speedX: 1,
        speedY: 2,
        color: '#000000',
        stunTimer: 0,
        lateralPhase: 0
      };
      s.entities.push(s.boss!);
    }

    // Regular Spawns based on distance
    if (!s.bossSpawned && spawnY - s.lastSpawnY > spawnDistance) {
      s.lastSpawnY = spawnY;
      
      // Decide what to spawn
      const spawnRand = Math.random();
      let type: 'enemy' | 'blood' | 'rock' | 'fox' = 'enemy';
      
      // As difficulty increases, enemies become more common, fuel becomes rarer
      const enemyChance = Math.min(0.8, 0.5 + (difficulty * 0.1));
      const fuelChance = enemyChance + Math.max(0.05, 0.2 - (difficulty * 0.05));
      const rockChance = fuelChance + 0.15;
      
      if (spawnRand < enemyChance) {
        type = 'enemy';
      } else if (spawnRand < fuelChance) {
        type = 'blood'; // Fuel
      } else if (spawnRand < rockChance) {
        type = 'rock';
      } else {
        type = 'fox'; // Extra points/lives
      }

      const bounds = getRoadBounds(spawnY);
      const spawnMargin = 30;

      if (type === 'fox') {
        s.entities.push({
          id: s.nextEntityId++,
          type: 'fox',
          x: bounds.left + spawnMargin + Math.random() * (bounds.width - 20 - spawnMargin * 2),
          y: spawnY,
          width: 20,
          height: 20,
          speedX: (Math.random() - 0.5) * 4,
          speedY: 1,
          color: '#00BFFF' // Blue flame
        });
      } else {
        const width = type === 'enemy' ? 30 : (type === 'blood' ? 50 : 40);
        const height = type === 'enemy' ? 50 : (type === 'blood' ? 50 : 40);
        const x = bounds.left + spawnMargin + Math.random() * (bounds.width - width - spawnMargin * 2);
        
        let behavior: 'static' | 'vertical' | 'lateral' = 'static';
        let speedX = 0;
        let speedY = 0;

        if (type === 'enemy') {
          const rand = Math.random();
          // As difficulty increases, more enemies have complex behaviors
          const staticChance = Math.max(0.1, 0.33 - (difficulty * 0.05));
          const verticalChance = staticChance + 0.33;
          
          if (rand < staticChance) {
              behavior = 'static';
          } else if (rand < verticalChance) {
              behavior = 'vertical';
              speedY = -2 - (Math.random() * 3 * difficulty); // Move UP (against player) faster
          } else {
              behavior = 'lateral';
              speedX = (2 + Math.random() * 3) * difficulty; // Move SIDEWAYS faster
          }
        }

        s.entities.push({
          id: s.nextEntityId++,
          type,
          behavior,
          x,
          y: spawnY,
          width,
          height,
          speedX,
          speedY,
          color: type === 'enemy' ? '#000000' : (type === 'blood' ? '#8B0000' : '#333333'),
          lateralPhase: Math.random() * Math.PI * 2
        });
      }
    }

    // --- Entity Updates & Collision ---
    s.entities = s.entities.filter(e => {
      // Stun logic
      if (e.stunTimer && e.stunTimer > 0) {
        e.stunTimer -= dt;
      } else {
        // Movement Logic based on Behavior
        if (e.type === 'enemy' && e.behavior === 'lateral') {
           // Ping pong movement
           e.x += e.speedX * dt;
           const bounds = getRoadBounds(e.y);
           if (e.x < bounds.left || e.x + e.width > bounds.right) {
             e.speedX *= -1;
             e.x = Math.max(bounds.left, Math.min(e.x, bounds.right - e.width));
           }
        } else if (e.type === 'enemy' && e.behavior === 'vertical') {
           // Constant vertical movement
           e.y += e.speedY * dt;
        } else if (e.type === 'fox') {
           e.x += e.speedX * dt;
           e.y += e.speedY * dt;
           const bounds = getRoadBounds(e.y);
           if (e.x < bounds.left || e.x + e.width > bounds.right) e.speedX *= -1;
        }
        // Static enemies don't move
      }

      // Remove if far behind
      if (e.y < s.cameraY - 200) return false;

      // --- Chain Collision ---
      if (p.attackState !== 'IDLE' && e.type === 'enemy') {
        const chainX = p.x + PLAYER_SIZE / 2;
        const chainYStart = p.y + PLAYER_SIZE;
        const chainYEnd = p.y + PLAYER_SIZE + p.chainLength;

        // Hitbox check
        if (
          chainX >= e.x && chainX <= e.x + e.width &&
          chainYEnd >= e.y && chainYStart <= e.y + e.height
        ) {
          if (e === s.boss) {
            e.stunTimer = 60;
            spawnParticles(e.x + e.width/2, e.y + e.height/2, '#FFFF00', 5);
          } else {
            spawnParticles(e.x + e.width/2, e.y + e.height/2, '#000000', 10);
            (s as any).killScore += 500; // 500 points per kill
            return false; // Destroy enemy
          }
        }
      }

      // --- Player Collision ---
      if (
        p.x < e.x + e.width &&
        p.x + PLAYER_SIZE > e.x &&
        p.y < e.y + e.height &&
        p.y + PLAYER_SIZE > e.y
      ) {
        if (e.type === 'fox') {
          p.fuel = Math.min(p.fuel + 15, MAX_FUEL);
          spawnParticles(e.x + e.width/2, e.y + e.height/2, '#00BFFF', 10);
          return false;
        } else if (e.type === 'blood') {
          p.x += (Math.random() - 0.5) * 20;
        } else if (!p.invulnerable) {
          handleDeath();
        }
      }

      return true;
    });

    // --- Wall Collision ---
    const playerBounds = getRoadBounds(p.y);
    if (p.x < playerBounds.left || p.x + PLAYER_SIZE > playerBounds.right) {
      if (!p.invulnerable) {
        handleDeath();
      } else {
        // Bounce if invulnerable
        p.x = Math.max(playerBounds.left, Math.min(p.x, playerBounds.right - PLAYER_SIZE));
      }
    }

    // --- Particles ---
    s.particles = s.particles.filter(pt => {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
      return pt.life > 0;
    });

    // --- Win Condition ---
    if (p.y >= LEVEL_LENGTH) {
      setFinalTime(Math.floor(s.gameTime));
      setGameState('VICTORY');
    }

    // Update Score (Distance + Kills handled elsewhere)
    // 1 point per 100 pixels traveled
    const distanceScore = Math.floor(p.y / 100);
    // We need to keep track of kill score separately or just add to a total score ref
    // For simplicity, let's just use distance for now, and add bonuses for kills directly to state?
    // No, updating state in loop is bad. Let's use a ref for score accumulator.
    // Actually, let's just set score based on distance + a kill counter in state ref.
    setScore(distanceScore + (state.current as any).killScore || 0);
  };

  const handleDeath = () => {
    const s = state.current;
    const p = s.player;
    
    p.lives--;
    p.fuel = Math.max(0, p.fuel - 10); // Penalty
    spawnParticles(p.x + PLAYER_SIZE/2, p.y + PLAYER_SIZE/2, '#FF0000', 20);

    if (p.lives <= 0) {
      setGameState('GAME_OVER');
    } else {
      // Respawn sequence
      p.respawnTimer = 60; // 1 second delay
      // Push back slightly? No, just freeze and reset X
    }
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const s = state.current;
    const p = s.player;

    // Clear
    ctx.fillStyle = '#d9c8a9'; // Parchment
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Camera Transform
    ctx.save();
    ctx.translate(0, -s.cameraY);

    // Draw Background Texture (Pseudo-random ink specks)
    const startY = Math.floor(s.cameraY / 100) * 100;
    const endY = startY + CANVAS_HEIGHT + 100;
    
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    for (let y = startY; y < endY; y += 40) {
      // Pseudo-random x based on y
      const seed = Math.sin(y * 0.123) * 10000;
      const x = Math.abs((seed - Math.floor(seed)) * CANVAS_WIDTH);
      const size = Math.abs(Math.cos(y * 0.05)) * 3 + 1;
      
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Chinese Symbols
    const symbols = ['死', '魂', '鬼', '神', '血', '闇', '光', '剣', '道', '命', '影', '月', '風', '空', '夢'];
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.font = '60px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = startY; y < endY; y += 150) {
      const seed = Math.sin(y * 0.456) * 10000;
      const x = Math.abs((seed - Math.floor(seed)) * CANVAS_WIDTH);
      const symbolIndex = Math.floor(Math.abs((seed * 10) % symbols.length));
      
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((seed % Math.PI) - Math.PI/2);
      ctx.fillText(symbols[symbolIndex], 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Draw Road Borders (Burnt Parchment Edges)
    // Left edge
    ctx.beginPath();
    for (let y = startY; y <= endY; y += 10) {
      const bounds = getRoadBounds(y);
      // Add jaggedness to the edge
      const jaggedX = bounds.left + (Math.sin(y * 0.1) * 5 + Math.cos(y * 0.05) * 3);
      if (y === startY) {
        ctx.moveTo(jaggedX, y);
      } else {
        ctx.lineTo(jaggedX, y);
      }
    }
    // Fill to the left edge of canvas to create the burnt out area
    ctx.lineTo(0, endY);
    ctx.lineTo(0, startY);
    ctx.closePath();
    
    // Gradient for burnt edge (left)
    const leftGradient = ctx.createLinearGradient(0, 0, ROAD_WIDTH, 0); // Approximate width for gradient
    leftGradient.addColorStop(0, '#2a1a10'); // Dark burnt
    leftGradient.addColorStop(0.5, '#5c3a21'); // Brown burnt
    leftGradient.addColorStop(1, 'transparent');
    
    ctx.fillStyle = '#1a0f0a'; // Solid dark outside
    ctx.fill();
    
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#3d2314';
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#1a0f0a';
    ctx.stroke();

    // Right edge
    ctx.beginPath();
    for (let y = startY; y <= endY; y += 10) {
      const bounds = getRoadBounds(y);
      const jaggedX = bounds.right + (Math.sin(y * 0.12) * 5 + Math.cos(y * 0.04) * 3);
      if (y === startY) {
        ctx.moveTo(jaggedX, y);
      } else {
        ctx.lineTo(jaggedX, y);
      }
    }
    // Fill to the right edge of canvas
    ctx.lineTo(CANVAS_WIDTH, endY);
    ctx.lineTo(CANVAS_WIDTH, startY);
    ctx.closePath();

    ctx.fillStyle = '#1a0f0a';
    ctx.fill();
    
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#3d2314';
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#1a0f0a';
    ctx.stroke();
    
    // Add some ash particles near the edges
    for(let i=0; i<5; i++) {
        const y = startY + Math.random() * (endY - startY);
        const bounds = getRoadBounds(y);
        const isLeft = Math.random() > 0.5;
        const x = isLeft ? bounds.left + (Math.random() * 20 - 10) : bounds.right + (Math.random() * 20 - 10);
        
        ctx.fillStyle = Math.random() > 0.5 ? '#3d2314' : '#1a0f0a';
        ctx.globalAlpha = Math.random() * 0.5 + 0.2;
        ctx.beginPath();
        ctx.arc(x, y, Math.random() * 3 + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // Draw Entities
    s.entities.forEach(e => {
      let x = e.x;
      let y = e.y;
      
      // Shake if stunned
      if (e.stunTimer && e.stunTimer > 0) {
        x += (Math.random() - 0.5) * 5;
      }

      if (e.type === 'fox') {
        drawInkCircle(ctx, x + e.width/2, y + e.height/2, e.width/2, e.color, 10);
        // Ears
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 5);
        ctx.lineTo(x, y - 5);
        ctx.lineTo(x + 10, y + 2);
        ctx.fill();
      } else if (e.type === 'blood') {
        // Puddle shape
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.ellipse(x + e.width/2, y + e.height/2, e.width/2, e.height/2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Enemy or Rock
        drawInkRect(ctx, x, y, e.width, e.height, e.color);
        // Eyes for enemies
        if (e.type === 'enemy') {
            ctx.fillStyle = 'red';
            ctx.fillRect(x + 5, y + 10, 5, 5);
            ctx.fillRect(x + e.width - 10, y + 10, 5, 5);
        }
      }
    });

    // Draw Particles
    s.particles.forEach(pt => {
      ctx.fillStyle = pt.color;
      ctx.globalAlpha = pt.life / 30;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Draw Torii Gate at end
    if (LEVEL_LENGTH < endY) {
        const bounds = getRoadBounds(LEVEL_LENGTH);
        ctx.fillStyle = '#FF0000';
        // Top bar
        drawInkRect(ctx, bounds.left - 40, LEVEL_LENGTH, bounds.width + 80, 20, '#FF0000');
        // Lower bar
        drawInkRect(ctx, bounds.left - 30, LEVEL_LENGTH + 40, bounds.width + 60, 15, '#FF0000');
        // Pillars
        drawInkRect(ctx, bounds.left - 10, LEVEL_LENGTH, 20, 250, '#FF0000');
        drawInkRect(ctx, bounds.right - 10, LEVEL_LENGTH, 20, 250, '#FF0000');
    }

    // Draw Player (if not respawning invisible)
    if (p.respawnTimer <= 0 || Math.floor(Date.now() / 100) % 2 === 0) {
      const playerDrawY = p.y + p.introYOffset;

      // Spirit trail
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.beginPath();
      ctx.arc(p.x + PLAYER_SIZE/2, playerDrawY - 10 + PLAYER_SIZE/2, PLAYER_SIZE/2 - 2, 0, Math.PI * 2);
      ctx.fill();
      
      drawInkCircle(ctx, p.x + PLAYER_SIZE/2, playerDrawY + PLAYER_SIZE/2, PLAYER_SIZE/2, '#FFFFFF', p.isCursed ? 20 : 10);

      // Draw Chain
      if (p.attackState !== 'IDLE') {
        drawChain(ctx, p.x + PLAYER_SIZE/2, playerDrawY + PLAYER_SIZE, p.chainLength);
      }
    }

    ctx.restore();

    // --- UI Overlay (No transform) ---
    
    // Curse Overlay
    if (p.isCursed) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        ctx.fillStyle = 'red';
        ctx.font = 'bold 30px serif';
        ctx.textAlign = 'center';
        ctx.fillText('MALDICIÓN', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        ctx.textAlign = 'left';
    }

    const marginX = Math.max(20, CANVAS_WIDTH * 0.05);
    const marginY = Math.max(20, CANVAS_HEIGHT * 0.05);

    // Lives (Top Left)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('VIDAS:', marginX, marginY);
    for (let i = 0; i < p.lives; i++) {
       ctx.fillStyle = '#00BFFF';
       ctx.beginPath();
       ctx.arc(marginX + 90 + i * 25, marginY, 10, 0, Math.PI * 2);
       ctx.fill();
    }

    // Fuel Bar (Top Left)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px serif';
    ctx.fillText('LLAMA DE VIDA', marginX, marginY + 35);
    
    const fuelBarWidth = Math.min(150, CANVAS_WIDTH * 0.3);
    const fuelBarHeight = 20;
    
    // Fuel Bar Background/Border
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(marginX, marginY + 50, fuelBarWidth, fuelBarHeight);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.strokeRect(marginX, marginY + 50, fuelBarWidth, fuelBarHeight);
    
    // Fuel Bar Fill
    ctx.fillStyle = p.fuel < 20 ? '#FF0000' : '#00BFFF';
    const fuelRatio = Math.max(0, p.fuel) / 100;
    ctx.fillRect(marginX + 2, marginY + 52, Math.max(0, fuelRatio * (fuelBarWidth - 4)), fuelBarHeight - 4);

    // Speed (Top Right, below React Score)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.floor(p.speed * 10)} km/h`, CANVAS_WIDTH - marginX, marginY + 80);
    ctx.textAlign = 'left'; // Reset
    ctx.textBaseline = 'alphabetic'; // Reset

    // Progress Bar (Bottom Center)
    const progress = Math.min(p.y / LEVEL_LENGTH, 1);
    const barWidth = Math.min(600, CANVAS_WIDTH - 100);
    const barHeight = 14;
    const barX = CANVAS_WIDTH / 2 - barWidth / 2;
    const barY = CANVAS_HEIGHT - 40;
    
    // Bar background
    ctx.fillStyle = 'rgba(20, 10, 5, 0.8)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    // Bar border
    ctx.strokeStyle = '#d9c8a9'; // Parchment color
    ctx.lineWidth = 2;
    ctx.strokeRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4);
    
    // Filled progress
    if (progress > 0) {
      const progressGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
      progressGradient.addColorStop(0, '#005c99');
      progressGradient.addColorStop(0.8, '#00BFFF'); 
      progressGradient.addColorStop(1, '#ffffff');
      
      ctx.fillStyle = progressGradient;
      ctx.fillRect(barX, barY, barWidth * progress, barHeight);
      
      // Glowing tip
      ctx.shadowColor = '#00BFFF';
      ctx.shadowBlur = 15;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(barX + barWidth * progress, barY + barHeight / 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0; // Reset shadow
    }
    
    // Markers
    ctx.fillStyle = '#d9c8a9';
    ctx.fillRect(barX + barWidth * 0.5 - 1, barY - 4, 2, barHeight + 8);
    
    // Labels
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Inicio', barX, barY - 10);
    ctx.fillText('Maldición', barX + barWidth * 0.5, barY - 10);
    ctx.fillText('Torii', barX + barWidth, barY - 10);
    ctx.textBaseline = 'alphabetic';
  };

  return (
    <div className="fixed inset-0 bg-stone-950 font-serif text-stone-100 overflow-hidden">
      <AnimatePresence>
        {gameState === 'TITLE' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 1 } }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-stone-950 text-stone-200"
          >
            <motion.h1 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 2, ease: "easeOut" }}
              className="text-6xl md:text-8xl font-bold tracking-widest text-red-600 mb-8"
              style={{ textShadow: '0 0 20px rgba(220, 38, 38, 0.5)' }}
            >
              THE LAST BREATH
            </motion.h1>
          </motion.div>
        )}

        {gameState === 'INTRO' && (
          <IntroCinematic onComplete={() => setGameState('MENU')} />
        )}
      </AnimatePresence>

      <div className="absolute inset-0 overflow-hidden bg-[#d9c8a9]">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block"
        />

        {/* HUD - Score and Pause */}
        {(gameState === 'PLAYING' || gameState === 'PAUSED') && (
            <div className="absolute top-4 right-4 md:top-6 md:right-6 flex items-start gap-4 z-20">
                <div className="text-right pointer-events-none">
                    <div className="text-3xl md:text-5xl font-bold text-white drop-shadow-md">{score.toLocaleString()}</div>
                    <div className="text-sm md:text-lg text-stone-300 font-bold uppercase tracking-widest">Kilómetros</div>
                </div>
                <button 
                  onClick={() => setGameState(prev => prev === 'PLAYING' ? 'PAUSED' : 'PLAYING')}
                  className="bg-stone-900/80 text-stone-200 hover:text-white hover:bg-stone-800 border border-stone-700 p-2 rounded-md transition-colors pointer-events-auto"
                  title={gameState === 'PLAYING' ? "Pausar (P)" : "Reanudar (P)"}
                >
                  {gameState === 'PLAYING' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  )}
                </button>
            </div>
        )}

        {/* Menu Screen */}
        {gameState === 'MENU' && (
          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center text-center p-8 z-10 backdrop-blur-sm">
            <h1 className="text-6xl md:text-8xl mb-12 tracking-widest text-red-600 font-bold uppercase" style={{ fontFamily: 'serif', textShadow: '4px 4px 0px black' }}>
              The Last Breath
            </h1>
            
            {menuView === 'MAIN' && (
              <div className="flex flex-col gap-6 w-64">
                <button
                  onClick={resetGame}
                  className="text-red-500 font-bold tracking-widest text-xl border-2 border-red-900/50 px-6 py-4 rounded bg-red-950/30 hover:bg-red-900/50 hover:scale-105 transition-all cursor-pointer"
                >
                  JUGAR
                </button>
                <button
                  onClick={() => setMenuView('CONTROLS')}
                  className="text-stone-300 font-bold tracking-widest text-lg border-2 border-stone-800 px-6 py-3 rounded bg-stone-900/50 hover:bg-stone-800/80 hover:scale-105 transition-all cursor-pointer"
                >
                  CONTROLES
                </button>
                <button
                  onClick={() => setMenuView('SCORE')}
                  className="text-stone-300 font-bold tracking-widest text-lg border-2 border-stone-800 px-6 py-3 rounded bg-stone-900/50 hover:bg-stone-800/80 hover:scale-105 transition-all cursor-pointer"
                >
                  PUNTUACIÓN
                </button>
                <button
                  onClick={() => setGameState('TITLE')}
                  className="text-stone-500 font-bold tracking-widest text-lg border-2 border-stone-900 px-6 py-3 rounded bg-black/50 hover:bg-stone-900/80 hover:text-stone-400 hover:scale-105 transition-all cursor-pointer mt-4"
                >
                  SALIR
                </button>
              </div>
            )}

            {menuView === 'CONTROLS' && (
              <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                <h2 className="text-3xl font-bold text-stone-200 mb-8 tracking-widest uppercase">Controles</h2>
                <div className="space-y-4 text-stone-300 text-lg md:text-xl mb-12">
                    <div className="flex items-center justify-between w-64 border-b border-stone-800 pb-2">
                        <span className="font-bold text-red-500">S</span>
                        <span>Acelerar</span>
                    </div>
                    <div className="flex items-center justify-between w-64 border-b border-stone-800 pb-2">
                        <span className="font-bold text-red-500">A / D</span>
                        <span>Moverse</span>
                    </div>
                    <div className="flex items-center justify-between w-64 border-b border-stone-800 pb-2">
                        <span className="font-bold text-red-500">ESPACIO / CLIC</span>
                        <span>Lanzar Cadenas</span>
                    </div>
                    <div className="flex items-center justify-between w-64 border-b border-stone-800 pb-2">
                        <span className="font-bold text-red-500">P / ESC</span>
                        <span>Pausar</span>
                    </div>
                </div>
                <button
                  onClick={() => setMenuView('MAIN')}
                  className="text-stone-400 hover:text-white tracking-widest uppercase border border-stone-700 px-6 py-2 rounded hover:bg-stone-800 transition-colors"
                >
                  Volver
                </button>
              </div>
            )}

            {menuView === 'SCORE' && (
              <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                <h2 className="text-3xl font-bold text-stone-200 mb-8 tracking-widest uppercase">Puntuación</h2>
                <div className="mb-12 text-center bg-stone-900/50 p-8 rounded-lg border border-stone-800">
                    <div className="text-sm text-stone-500 uppercase tracking-widest mb-2">Récord Actual</div>
                    <div className="text-6xl font-bold text-yellow-500 drop-shadow-lg">{highScore.toLocaleString()}</div>
                    <div className="text-sm text-stone-400 mt-4 uppercase tracking-widest">Kilómetros recorridos</div>
                </div>
                <button
                  onClick={() => setMenuView('MAIN')}
                  className="text-stone-400 hover:text-white tracking-widest uppercase border border-stone-700 px-6 py-2 rounded hover:bg-stone-800 transition-colors"
                >
                  Volver
                </button>
              </div>
            )}
          </div>
        )}

        {/* Pause Screen */}
        {gameState === 'PAUSED' && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-center p-8 z-10 backdrop-blur-sm">
            <h2 className="text-6xl text-white mb-8 font-bold tracking-widest uppercase" style={{ textShadow: '0 0 20px rgba(255, 255, 255, 0.5)' }}>PAUSA</h2>
            
            <button
              onClick={() => setGameState('PLAYING')}
              className="animate-pulse text-stone-200 font-bold tracking-widest text-lg border-2 border-stone-600 px-8 py-4 rounded bg-stone-900/50 hover:bg-stone-800/80 transition-colors cursor-pointer"
            >
              REANUDAR
            </button>
          </div>
        )}

        {/* Game Over Screen */}
        {gameState === 'GAME_OVER' && (
          <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center text-center p-8 z-20">
            <h2 className="text-6xl text-red-600 mb-2 font-bold font-serif tracking-tighter" style={{ textShadow: '0 0 30px red' }}>GAME OVER</h2>
            <p className="text-stone-500 mb-8 italic">Tu último aliento se ha desvanecido.</p>
            
            <div className="grid grid-cols-2 gap-8 mb-12 w-full max-w-xs">
                <div className="text-center">
                    <div className="text-xs text-stone-500 uppercase tracking-widest mb-1">Puntos</div>
                    <div className="text-3xl font-bold text-white">{score.toLocaleString()}</div>
                </div>
                <div className="text-center">
                    <div className="text-xs text-stone-500 uppercase tracking-widest mb-1">Récord</div>
                    <div className="text-3xl font-bold text-yellow-500">{highScore.toLocaleString()}</div>
                </div>
            </div>

            <div className="flex flex-col gap-4 w-64">
              <button
                onClick={resetGame}
                className="text-red-500 font-bold tracking-widest text-lg border-2 border-red-900/50 px-6 py-3 rounded bg-red-950/30 hover:bg-red-900/50 hover:scale-105 transition-all cursor-pointer"
              >
                REINICIAR
              </button>
              <button
                onClick={() => {
                  setGameState('MENU');
                  setMenuView('SCORE');
                }}
                className="text-stone-300 font-bold tracking-widest text-lg border-2 border-stone-800 px-6 py-3 rounded bg-stone-900/50 hover:bg-stone-800/80 hover:scale-105 transition-all cursor-pointer"
              >
                PUNTUACIÓN
              </button>
              <button
                onClick={() => {
                  setGameState('MENU');
                  setMenuView('MAIN');
                }}
                className="text-stone-500 font-bold tracking-widest text-lg border-2 border-stone-900 px-6 py-3 rounded bg-black/50 hover:bg-stone-900/80 hover:text-stone-400 hover:scale-105 transition-all cursor-pointer"
              >
                SALIR AL MENÚ
              </button>
            </div>
          </div>
        )}

        {/* Victory Screen */}
        {gameState === 'VICTORY' && (
          <div className="absolute inset-0 bg-red-950/95 flex flex-col items-center justify-center text-center p-8 z-20">
            <h2 className="text-5xl text-white mb-4 font-bold tracking-widest">PURIFICACIÓN</h2>
            <p className="text-xl text-stone-300 mb-8 max-w-xs">Has alcanzado el Torii sagrado y roto la maldición.</p>
            
            <div className="text-center mb-12">
                <div className="text-xs text-red-300 uppercase tracking-widest mb-1">Puntuación Final</div>
                <div className="text-5xl font-bold text-white drop-shadow-lg">{score.toLocaleString()}</div>
            </div>

            <div className="animate-pulse text-red-200 text-sm tracking-widest border border-red-800 px-4 py-2 rounded">
              PRESIONA ENTER PARA VOLVER
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
