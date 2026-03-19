const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ==================== 游戏数据存储 ====================
const rooms = new Map();
const playerSockets = new Map();

// ==================== 麻将牌相关 ====================
function createTile(suit, value) {
  const suitNames = { wan: '万', tong: '筒', tiao: '条', wind: '风', dragon: '箭' };
  let name = '';
  if (suit === 'wind') {
    const windNames = { 1: '东', 2: '南', 3: '西', 4: '北' };
    name = windNames[value] || '';
  } else if (suit === 'dragon') {
    const dragonNames = { 1: '中', 2: '发', 3: '白' };
    name = dragonNames[value] || '';
  } else {
    name = value + suitNames[suit];
  }
  return {
    id: suit + '_' + value + '_' + Math.random().toString(36).substr(2, 9),
    suit,
    value,
    name
  };
}

function createFullDeck() {
  const deck = [];
  ['wan', 'tong', 'tiao'].forEach(suit => {
    for (let value = 1; value <= 9; value++) {
      for (let i = 0; i < 4; i++) {
        deck.push(createTile(suit, value));
      }
    }
  });
  for (let value = 1; value <= 4; value++) {
    for (let i = 0; i < 4; i++) {
      deck.push(createTile('wind', value));
    }
  }
  for (let value = 1; value <= 3; value++) {
    for (let i = 0; i < 4; i++) {
      deck.push(createTile('dragon', value));
    }
  }
  return shuffleDeck(deck);
}

function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function isSameTile(tile1, tile2) {
  return tile1.suit === tile2.suit && tile1.value === tile2.value;
}

function isLaiZi(tile, laiZiTile) {
  if (!laiZiTile) return false;
  return isSameTile(tile, laiZiTile);
}

function getLaiZiCount(tiles, laiZiTile) {
  if (!laiZiTile) return 0;
  return tiles.filter(tile => isLaiZi(tile, laiZiTile)).length;
}

function sortTiles(tiles) {
  const suitOrder = { wan: 0, tong: 1, tiao: 2, wind: 3, dragon: 4 };
  return [...tiles].sort((a, b) => {
    const suitDiff = suitOrder[a.suit] - suitOrder[b.suit];
    if (suitDiff !== 0) return suitDiff;
    return a.value - b.value;
  });
}

// ==================== 胡牌判断 ====================
function canHu(handTiles, chiPengTiles, targetTile, laiZiTile) {
  const allTiles = [...handTiles, targetTile];
  const laiZiCount = getLaiZiCount(allTiles, laiZiTile);
  
  if (isQiXiaoDui(allTiles, laiZiTile)) {
    return { canHu: true, huType: 'qixiaodui', laiZiCount };
  }
  
  if (isShiSanBuKao(allTiles, laiZiTile)) {
    return { canHu: true, huType: 'shisanbukao', laiZiCount };
  }
  
  if (isDuiDuiHu(allTiles, chiPengTiles, laiZiTile)) {
    return { canHu: true, huType: 'duiduihu', laiZiCount };
  }
  
  if (isPingHu(allTiles, chiPengTiles, laiZiTile)) {
    return { canHu: true, huType: 'pinghu', laiZiCount };
  }
  
  return { canHu: false, laiZiCount };
}

function isQiXiaoDui(tiles, laiZiTile) {
  if (tiles.length !== 14) return false;
  const normalTiles = tiles.filter(t => !isLaiZi(t, laiZiTile));
  const laiZiCount = tiles.length - normalTiles.length;
  
  const tileCounts = new Map();
  for (const tile of normalTiles) {
    const key = tile.suit + '-' + tile.value;
    tileCounts.set(key, (tileCounts.get(key) || 0) + 1);
  }
  
  let pairs = 0;
  let singles = 0;
  
  for (const count of tileCounts.values()) {
    if (count === 2) pairs++;
    else if (count === 1) singles++;
    else if (count === 4) pairs += 2;
    else if (count === 3) { pairs++; singles++; }
  }
  
  const neededLaiZi = Math.ceil(singles / 2);
  return pairs + neededLaiZi === 7 && laiZiCount >= neededLaiZi;
}

function isShiSanBuKao(tiles, laiZiTile) {
  if (tiles.length !== 14) return false;
  const normalTiles = tiles.filter(t => !isLaiZi(t, laiZiTile));
  const laiZiCount = tiles.length - normalTiles.length;
  
  const neededSets = [
    new Set([1, 4, 7]),
    new Set([1, 4, 7]),
    new Set([1, 4, 7]),
    new Set([1, 2, 3, 4]),
    new Set([1, 2, 3])
  ];
  
  let counts = { wan: 0, tong: 0, tiao: 0, wind: 0, dragon: 0 };
  
  for (const tile of normalTiles) {
    if (tile.suit === 'wan' && neededSets[0].has(tile.value)) counts.wan++;
    else if (tile.suit === 'tong' && neededSets[1].has(tile.value)) counts.tong++;
    else if (tile.suit === 'tiao' && neededSets[2].has(tile.value)) counts.tiao++;
    else if (tile.suit === 'wind' && neededSets[3].has(tile.value)) counts.wind++;
    else if (tile.suit === 'dragon' && neededSets[4].has(tile.value)) counts.dragon++;
    else return false;
  }
  
  const missing = (3 - counts.wan) + (3 - counts.tong) + (3 - counts.tiao) + (4 - counts.wind) + (3 - counts.dragon);
  return missing <= laiZiCount;
}

function isDuiDuiHu(tiles, chiPengTiles, laiZiTile) {
  const normalTiles = tiles.filter(t => !isLaiZi(t, laiZiTile));
  const laiZiCount = tiles.length - normalTiles.length;
  
  const tileCounts = new Map();
  for (const tile of normalTiles) {
    const key = tile.suit + '-' + tile.value;
    tileCounts.set(key, (tileCounts.get(key) || 0) + 1);
  }
  
  let kezi = chiPengTiles.length;
  let pairs = 0;
  let neededLaiZi = 0;
  
  for (const count of tileCounts.values()) {
    if (count >= 3) kezi++;
    else if (count === 2) pairs++;
    else if (count === 1) {
      if (laiZiCount >= 2) { neededLaiZi += 2; kezi++; }
      else if (laiZiCount >= 1) { neededLaiZi += 1; pairs++; }
    }
  }
  
  let remainingLaiZi = laiZiCount - neededLaiZi;
  while (kezi < 4 && remainingLaiZi >= 2) { kezi++; remainingLaiZi -= 2; }
  if (pairs === 0 && remainingLaiZi >= 1) { pairs++; remainingLaiZi--; }
  
  return kezi >= 4 && pairs >= 1;
}

function isPingHu(tiles, chiPengTiles, laiZiTile) {
  const normalTiles = tiles.filter(t => !isLaiZi(t, laiZiTile));
  const laiZiCount = tiles.length - normalTiles.length;
  const neededMelds = 4 - chiPengTiles.length;
  return canFormHu(normalTiles, neededMelds, laiZiCount);
}

function canFormHu(tiles, neededMelds, laiZiCount) {
  if (tiles.length === 0 && neededMelds === 0) return true;
  if (tiles.length === 0) return false;
  if (neededMelds < 0) return false;
  
  const bySuit = groupBySuit(tiles);
  
  for (const [suit, suitTiles] of bySuit) {
    if (suit === 'wind' || suit === 'dragon') continue;
    
    const counts = countTiles(suitTiles);
    
    for (const [key, count] of counts) {
      if (count >= 2) {
        const remaining = removeTiles(tiles, key, 2);
        if (canFormMelds(remaining, neededMelds, laiZiCount)) return true;
      } else if (count === 1 && laiZiCount >= 1) {
        const remaining = removeTiles(tiles, key, 1);
        if (canFormMelds(remaining, neededMelds, laiZiCount - 1)) return true;
      }
    }
  }
  
  return false;
}

function canFormMelds(tiles, neededMelds, laiZiCount) {
  if (neededMelds === 0) return tiles.length === 0;
  if (tiles.length === 0) return false;
  if (tiles.length > neededMelds * 3 + laiZiCount) return false;
  
  const bySuit = groupBySuit(tiles);
  
  for (const [suit, suitTiles] of bySuit) {
    const counts = countTiles(suitTiles);
    
    for (const [key, count] of counts) {
      const value = parseInt(key.split('-')[1]);
      
      if (count >= 3) {
        const remaining = removeTiles(tiles, key, 3);
        if (canFormMelds(remaining, neededMelds - 1, laiZiCount)) return true;
      }
      
      if (suit !== 'wind' && suit !== 'dragon' && value <= 7) {
        const key1 = suit + '-' + (value + 1);
        const key2 = suit + '-' + (value + 2);
        const count1 = counts.get(key1) || 0;
        const count2 = counts.get(key2) || 0;
        
        if (count >= 1 && count1 >= 1 && count2 >= 1) {
          let remaining = removeTiles(tiles, key, 1);
          remaining = removeTiles(remaining, key1, 1);
          remaining = removeTiles(remaining, key2, 1);
          if (canFormMelds(remaining, neededMelds - 1, laiZiCount)) return true;
        }
        
        const neededLaiZi = (count >= 1 ? 0 : 1) + (count1 >= 1 ? 0 : 1) + (count2 >= 1 ? 0 : 1);
        if (laiZiCount >= neededLaiZi) {
          let remaining = [...tiles];
          if (count >= 1) remaining = removeTiles(remaining, key, 1);
          if (count1 >= 1) remaining = removeTiles(remaining, key1, 1);
          if (count2 >= 1) remaining = removeTiles(remaining, key2, 1);
          if (canFormMelds(remaining, neededMelds - 1, laiZiCount - neededLaiZi)) return true;
        }
      }
      
      if (count >= 2 && laiZiCount >= 1) {
        const remaining = removeTiles(tiles, key, 2);
        if (canFormMelds(remaining, neededMelds - 1, laiZiCount - 1)) return true;
      }
      if (count >= 1 && laiZiCount >= 2) {
        const remaining = removeTiles(tiles, key, 1);
        if (canFormMelds(remaining, neededMelds - 1, laiZiCount - 2)) return true;
      }
    }
  }
  
  return false;
}

function groupBySuit(tiles) {
  const map = new Map();
  for (const tile of tiles) {
    if (!map.has(tile.suit)) map.set(tile.suit, []);
    map.get(tile.suit).push(tile);
  }
  return map;
}

function countTiles(tiles) {
  const counts = new Map();
  for (const tile of tiles) {
    const key = tile.suit + '-' + tile.value;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function removeTiles(tiles, key, count) {
  const result = [...tiles];
  let removed = 0;
  for (let i = 0; i < result.length && removed < count; i++) {
    const tileKey = result[i].suit + '-' + result[i].value;
    if (tileKey === key) {
      result.splice(i, 1);
      removed++;
      i--;
    }
  }
  return result;
}

function canChi(tiles, targetTile, playerPosition, dealerPosition) {
  const result = [];
  const expectedPosition = (dealerPosition + 3) % 4;
  if (playerPosition !== expectedPosition) return result;
  if (targetTile.suit === 'wind' || targetTile.suit === 'dragon') return result;
  
  const suit = targetTile.suit;
  const value = targetTile.value;
  
  if (value >= 3) {
    const tile1 = tiles.find(t => t.suit === suit && t.value === value - 2);
    const tile2 = tiles.find(t => t.suit === suit && t.value === value - 1);
    if (tile1 && tile2) result.push([tile1, tile2, targetTile]);
  }
  
  if (value >= 2 && value <= 8) {
    const tile1 = tiles.find(t => t.suit === suit && t.value === value - 1);
    const tile2 = tiles.find(t => t.suit === suit && t.value === value + 1);
    if (tile1 && tile2) result.push([tile1, targetTile, tile2]);
  }
  
  if (value <= 7) {
    const tile1 = tiles.find(t => t.suit === suit && t.value === value + 1);
    const tile2 = tiles.find(t => t.suit === suit && t.value === value + 2);
    if (tile1 && tile2) result.push([targetTile, tile1, tile2]);
  }
  
  return result;
}

function canPeng(tiles, targetTile) {
  const sameTiles = tiles.filter(t => isSameTile(t, targetTile));
  if (sameTiles.length >= 2) return [sameTiles[0], sameTiles[1], targetTile];
  return null;
}

function canMingGang(tiles, targetTile) {
  const sameTiles = tiles.filter(t => isSameTile(t, targetTile));
  if (sameTiles.length >= 3) return [sameTiles[0], sameTiles[1], sameTiles[2], targetTile];
  return null;
}

function canAnGang(tiles, laiZiTile) {
  const result = [];
  const checked = new Set();
  
  for (const tile of tiles) {
    const key = tile.suit + '-' + tile.value;
    if (checked.has(key)) continue;
    checked.add(key);
    if (isLaiZi(tile, laiZiTile)) continue;
    
    const sameTiles = tiles.filter(t => isSameTile(t, tile));
    if (sameTiles.length === 4) result.push(sameTiles);
  }
  
  return result;
}

// ==================== 游戏逻辑 ====================
function initGame(room) {
  const deck = createFullDeck();
  const players = room.players;
  const tilesPerPlayer = 13;
  const totalDealt = tilesPerPlayer * players.length;
  
  for (let i = 0; i < players.length; i++) {
    players[i].handTiles = sortTiles(deck.slice(i * tilesPerPlayer, (i + 1) * tilesPerPlayer));
    players[i].playedTiles = [];
    players[i].chiPengTiles = [];
    players[i].gangTiles = [];
    players[i].isReady = false;
  }
  
  const laiZiIndex = totalDealt;
  const laiZiTile = deck[laiZiIndex];
  const wallTiles = deck.slice(laiZiIndex + 1);
  const dealer = Math.floor(Math.random() * players.length);
  
  return {
    phase: 'playing',
    currentPlayer: dealer,
    dealer,
    lianZhuangCount: room.lianZhuangCount || 0,
    wallTiles,
    discardedTiles: [],
    laiZiTile,
    round: (room.gameState?.round || 0) + 1,
    actions: [],
    lastPlayedTile: null,
    lastAction: null
  };
}

function drawTile(gameState, player) {
  if (gameState.wallTiles.length === 0) return { success: false, error: '牌墙已空' };
  if (gameState.wallTiles.length <= 17) return { success: false, error: '流局' };
  
  const tile = gameState.wallTiles.shift();
  player.handTiles.push(tile);
  player.handTiles = sortTiles(player.handTiles);
  
  gameState.actions.push({
    type: 'draw',
    playerId: player.id,
    tiles: [tile],
    timestamp: Date.now()
  });
  
  return { success: true, tile };
}

function playTile(gameState, player, tileId) {
  const tileIndex = player.handTiles.findIndex(t => t.id === tileId);
  if (tileIndex === -1) return { success: false, error: '手牌中没有这张牌' };
  
  const tile = player.handTiles[tileIndex];
  player.handTiles.splice(tileIndex, 1);
  gameState.discardedTiles.push(tile);
  player.playedTiles.push(tile);
  
  const action = {
    type: 'play',
    playerId: player.id,
    tiles: [tile],
    timestamp: Date.now()
  };
  gameState.actions.push(action);
  gameState.lastPlayedTile = tile;
  gameState.lastAction = action;
  
  return { success: true, action };
}

function doChi(gameState, player, tiles, targetTile) {
  const chiPengCount = player.chiPengTiles.filter(group => group.length === 3).length;
  if (chiPengCount >= 2) return { success: false, error: '吃碰次数已达上限' };
  
  for (const tile of tiles) {
    if (isSameTile(tile, targetTile)) continue;
    const index = player.handTiles.findIndex(t => t.id === tile.id);
    if (index !== -1) player.handTiles.splice(index, 1);
  }
  
  player.chiPengTiles.push([...tiles]);
  
  const discardIndex = gameState.discardedTiles.findIndex(t => t.id === targetTile.id);
  if (discardIndex !== -1) gameState.discardedTiles.splice(discardIndex, 1);
  
  gameState.actions.push({
    type: 'chi',
    playerId: player.id,
    tiles: [...tiles],
    targetTile,
    timestamp: Date.now()
  });
  
  return { success: true };
}

function doPeng(gameState, player, tiles, targetTile) {
  const chiPengCount = player.chiPengTiles.filter(group => group.length === 3).length;
  if (chiPengCount >= 2) return { success: false, error: '吃碰次数已达上限' };
  
  for (const tile of tiles) {
    if (isSameTile(tile, targetTile)) continue;
    const index = player.handTiles.findIndex(t => t.id === tile.id);
    if (index !== -1) player.handTiles.splice(index, 1);
  }
  
  player.chiPengTiles.push([...tiles]);
  
  const discardIndex = gameState.discardedTiles.findIndex(t => t.id === targetTile.id);
  if (discardIndex !== -1) gameState.discardedTiles.splice(discardIndex, 1);
  
  gameState.actions.push({
    type: 'peng',
    playerId: player.id,
    tiles: [...tiles],
    targetTile,
    timestamp: Date.now()
  });
  
  return { success: true };
}

function doGang(gameState, player, tiles, targetTile, isAnGang) {
  if (isAnGang) {
    for (const tile of tiles) {
      const index = player.handTiles.findIndex(t => t.id === tile.id);
      if (index !== -1) player.handTiles.splice(index, 1);
    }
  } else {
    for (const tile of tiles) {
      if (isSameTile(tile, targetTile)) continue;
      const index = player.handTiles.findIndex(t => t.id === tile.id);
      if (index !== -1) player.handTiles.splice(index, 1);
    }
    const discardIndex = gameState.discardedTiles.findIndex(t => t.id === targetTile.id);
    if (discardIndex !== -1) gameState.discardedTiles.splice(discardIndex, 1);
  }
  
  player.gangTiles.push([...tiles]);
  
  gameState.actions.push({
    type: 'gang',
    playerId: player.id,
    tiles: [...tiles],
    targetTile,
    timestamp: Date.now()
  });
  
  return { success: true };
}

function doHu(gameState, players, winner, targetTile, isZiMo, playedPlayerId) {
  const huResult = canHu(winner.handTiles, winner.chiPengTiles, targetTile, gameState.laiZiTile);
  if (!huResult.canHu) return [];
  
  const laiZiCount = huResult.laiZiCount;
  const lianZhuangCount = gameState.lianZhuangCount;
  
  let baseScore = 8;
  if (laiZiCount === 1) baseScore = 7;
  else if (laiZiCount === 2) baseScore = 8;
  else if (laiZiCount >= 3) baseScore = 9;
  
  baseScore += 5 * lianZhuangCount;
  
  const results = [];
  
  if (isZiMo) {
    for (const player of players) {
      if (player.id === winner.id) {
        player.score += baseScore * 2 * 3;
      } else {
        player.score -= baseScore * 2;
      }
    }
    
    results.push({
      winnerId: winner.id,
      huType: huResult.huType,
      baseScore,
      laiZiCount,
      totalScore: baseScore * 2 * 3,
      isZiMo: true,
      details: '自摸' + huResult.huType + '，获得' + (baseScore * 2 * 3) + '分'
    });
  } else {
    const loser = players.find(p => p.id === playedPlayerId);
    if (loser) {
      loser.score -= baseScore * 2;
      
      for (const player of players) {
        if (player.id !== winner.id && player.id !== loser.id) {
          player.score -= baseScore;
        }
      }
      
      const totalScore = baseScore * 2 + baseScore * 2;
      winner.score += totalScore;
      
      results.push({
        winnerId: winner.id,
        loserId: loser.id,
        huType: huResult.huType,
        baseScore,
        laiZiCount,
        totalScore,
        isZiMo: false,
        details: '胡' + loser.nickname + '的' + huResult.huType + '，获得' + totalScore + '分'
      });
    }
  }
  
  gameState.huResults = results;
  gameState.phase = 'settled';
  
  return results;
}

// ==================== Socket事件处理 ====================
io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);
  
  // 创建房间
  socket.on('create_room', ({ roomName, player, maxPlayers = 4, customRoomId }) => {
    const roomId = customRoomId?.trim() || 'room_' + Date.now().toString(36).substr(2, 8).toUpperCase();
    
    if (rooms.has(roomId)) {
      socket.emit('connect_error', '房间号已存在');
      return;
    }
    
    const room = {
      id: roomId,
      name: roomName,
      players: [{ ...player, position: 0, socketId: socket.id, isReady: false }],
      maxPlayers,
      hostId: player.id,
      createdAt: Date.now(),
      voiceEnabled: false,
      lianZhuangCount: 0
    };
    
    rooms.set(roomId, room);
    playerSockets.set(player.id, socket.id);
    socket.join(roomId);
    
    console.log('创建房间:', roomId, roomName);
    socket.emit('room_updated', room);
    io.emit('room_list', Array.from(rooms.values()));
  });
  
  // 加入房间
  socket.on('join_room', ({ roomId, player }) => {
    console.log('加入房间请求:', roomId, '玩家:', player.nickname);
    
    const room = rooms.get(roomId);
    if (!room) {
      console.log('房间不存在:', roomId);
      socket.emit('connect_error', '房间不存在');
      return;
    }
    
    // 检查玩家是否已经在房间中
    const existingPlayerIndex = room.players.findIndex(p => p.id === player.id);
    if (existingPlayerIndex >= 0) {
      // 更新socketId
      room.players[existingPlayerIndex].socketId = socket.id;
      playerSockets.set(player.id, socket.id);
      socket.join(roomId);
      socket.emit('room_updated', room);
      console.log('玩家重新加入房间:', roomId, player.nickname);
      return;
    }
    
    if (room.players.length >= room.maxPlayers) {
      socket.emit('connect_error', '房间已满');
      return;
    }
    
    const position = room.players.length;
    // 机器人自动准备
    const isBot = player.id.startsWith('bot_');
    const newPlayer = { ...player, position, socketId: socket.id, isReady: isBot };
    room.players.push(newPlayer);
    playerSockets.set(player.id, socket.id);
    
    socket.join(roomId);
    
    console.log('玩家加入房间:', roomId, player.nickname, '当前人数:', room.players.length, isBot ? '(机器人)' : '');
    
    io.to(roomId).emit('room_updated', room);
    io.to(roomId).emit('player_joined', newPlayer);
    io.emit('room_list', Array.from(rooms.values()));
  });
  
  // 离开房间
  socket.on('leave_room', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex !== -1) {
      const player = room.players[playerIndex];
      room.players.splice(playerIndex, 1);
      playerSockets.delete(player.id);
      
      console.log('玩家离开房间:', roomId, player.nickname);
      
      if (room.players.length === 0) {
        rooms.delete(roomId);
        console.log('房间已删除:', roomId);
      } else {
        if (room.hostId === player.id && room.players.length > 0) {
          room.hostId = room.players[0].id;
        }
        // 更新位置
        room.players.forEach((p, i) => { p.position = i; });
        io.to(roomId).emit('player_left', player.id);
        io.to(roomId).emit('room_updated', room);
      }
    }
    
    socket.leave(roomId);
    io.emit('room_list', Array.from(rooms.values()));
  });
  
  // 玩家准备
  socket.on('player_ready', ({ roomId, playerId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.isReady = true;
      io.to(roomId).emit('room_updated', room);
    }
  });
  
  // 辅助函数：向每个玩家发送游戏状态，隐藏其他玩家的手牌
  function emitGameStateToPlayers(room, gameState, eventName = 'game_state_updated') {
    // 获取所有真实玩家（非机器人）的唯一socketId
    const realPlayerSocketIds = new Set();
    room.players.forEach(player => {
      if (!player.id.startsWith('bot_')) {
        const socketId = playerSockets.get(player.id);
        if (socketId) {
          realPlayerSocketIds.add(socketId);
        }
      }
    });
    
    // 向每个真实玩家发送数据
    realPlayerSocketIds.forEach(socketId => {
      // 找到该socket对应的真实玩家
      const realPlayer = room.players.find(p => playerSockets.get(p.id) === socketId && !p.id.startsWith('bot_'));
      if (realPlayer) {
        const playerRoom = {
          ...room,
          players: room.players.map(p => ({
            ...p,
            handTiles: p.id === realPlayer.id ? p.handTiles : [] // 只保留自己的手牌
          }))
        };
        io.to(socketId).emit(eventName, { room: playerRoom, gameState });
      }
    });
  }
  
  // 开始游戏
  socket.on('start_game', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const gameState = initGame(room);
    room.gameState = gameState;
    
    console.log('游戏开始:', roomId, '庄家:', gameState.dealer);
    
    // 使用emitGameStateToPlayers发送数据
    emitGameStateToPlayers(room, gameState, 'game_started');
  });
  
  // 摸牌
  socket.on('draw_tile', ({ roomId, playerId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    
    const result = drawTile(room.gameState, player);
    if (result.success) {
      emitGameStateToPlayers(room, room.gameState, 'game_state_updated');
    }
  });
  
  // 打牌
  socket.on('play_tile', ({ roomId, playerId, tileId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    
    const result = playTile(room.gameState, player, tileId);
    if (result.success) {
      room.gameState.currentPlayer = (room.gameState.currentPlayer + 1) % room.players.length;
      emitGameStateToPlayers(room, room.gameState, 'game_state_updated');
    }
  });
  
  // 吃
  socket.on('chi', ({ roomId, playerId, tiles, targetTile }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    
    const result = doChi(room.gameState, player, tiles, targetTile);
    if (result.success) {
      emitGameStateToPlayers(room, room.gameState, 'game_state_updated');
    }
  });
  
  // 碰
  socket.on('peng', ({ roomId, playerId, tiles, targetTile }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    
    const result = doPeng(room.gameState, player, tiles, targetTile);
    if (result.success) {
      emitGameStateToPlayers(room, room.gameState, 'game_state_updated');
    }
  });
  
  // 杠
  socket.on('gang', ({ roomId, playerId, tiles, targetTile, isAnGang }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    
    const result = doGang(room.gameState, player, tiles, targetTile, isAnGang);
    if (result.success) {
      drawTile(room.gameState, player);
      emitGameStateToPlayers(room, room.gameState, 'game_state_updated');
    }
  });
  
  // 胡
  socket.on('hu', ({ roomId, playerId, targetTile, isZiMo, playedPlayerId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    
    const results = doHu(room.gameState, room.players, player, targetTile, isZiMo, playedPlayerId);
    if (results.length > 0) {
      // 连庄处理
      if (isZiMo && room.gameState.dealer === room.players.findIndex(p => p.id === playerId)) {
        room.lianZhuangCount++;
      } else {
        room.lianZhuangCount = 0;
      }
      
      io.to(roomId).emit('hu_result', { room, gameState: room.gameState, results });
    }
  });
  
  // 过
  socket.on('pass', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    
    room.gameState.currentPlayer = (room.gameState.currentPlayer + 1) % room.players.length;
    emitGameStateToPlayers(room, room.gameState, 'game_state_updated');
  });
  
  // 聊天消息
  socket.on('chat_message', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    io.to(roomId).emit('chat_message', message);
  });
  
  // 获取房间列表
  socket.on('get_room_list', () => {
    socket.emit('room_list', Array.from(rooms.values()));
  });
  
  // 语音相关
  socket.on('voice_join', ({ roomId, playerId }) => {
    socket.to(roomId).emit('voice_join', { playerId });
  });
  
  socket.on('voice_leave', ({ roomId, playerId }) => {
    socket.to(roomId).emit('voice_leave', { playerId });
  });
  
  socket.on('voice_offer', ({ roomId, targetId, offer }) => {
    const targetSocketId = playerSockets.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('voice_offer', { targetId: socket.id, offer });
    }
  });
  
  socket.on('voice_answer', ({ roomId, targetId, answer }) => {
    const targetSocketId = playerSockets.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('voice_answer', { targetId: socket.id, answer });
    }
  });
  
  socket.on('voice_ice_candidate', ({ roomId, targetId, candidate }) => {
    const targetSocketId = playerSockets.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('voice_ice_candidate', { targetId: socket.id, candidate });
    }
  });
  
  // 断开连接
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    
    // 从所有房间中移除该玩家
    rooms.forEach((room, roomId) => {
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        room.players.splice(playerIndex, 1);
        playerSockets.delete(player.id);
        
        console.log('玩家断开，从房间移除:', roomId, player.nickname);
        
        if (room.players.length === 0) {
          rooms.delete(roomId);
          console.log('房间已删除:', roomId);
        } else {
          if (room.hostId === player.id && room.players.length > 0) {
            room.hostId = room.players[0].id;
          }
          // 更新位置
          room.players.forEach((p, i) => { p.position = i; });
          io.to(roomId).emit('player_left', player.id);
          io.to(roomId).emit('room_updated', room);
        }
        
        io.emit('room_list', Array.from(rooms.values()));
      }
    });
  });
});

// ==================== HTTP路由 ====================
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '慈溪麻将服务器运行中',
    rooms: rooms.size,
    players: Array.from(rooms.values()).reduce((acc, r) => acc + r.players.length, 0)
  });
});

app.get('/rooms', (req, res) => {
  res.json(Array.from(rooms.values()));
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log('=================================');
  console.log('慈溪麻将服务器已启动');
  console.log('端口: ' + PORT);
  console.log('地址: http://localhost:' + PORT);
  console.log('=================================');
});
