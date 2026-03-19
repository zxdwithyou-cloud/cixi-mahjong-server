     1	const express = require('express');
     2	const { createServer } = require('http');
     3	const { Server } = require('socket.io');
     4	const cors = require('cors');
     5	
     6	const app = express();
     7	app.use(cors());
     8	
     9	const httpServer = createServer(app);
    10	const io = new Server(httpServer, {
    11	  cors: {
    12	    origin: "*",
    13	    methods: ["GET", "POST"]
    14	  }
    15	});
    16	
    17	// ==================== 游戏数据存储 ====================
    18	const rooms = new Map();
    19	const playerSockets = new Map(); // playerId -> socketId
    20	
    21	// ==================== 麻将牌相关 ====================
    22	const SUITS = ['wan', 'tong', 'tiao', 'wind', 'dragon'];
    23	
    24	function createTile(suit, value) {
    25	  const suitNames = { wan: '万', tong: '筒', tiao: '条', wind: '风', dragon: '箭' };
    26	  let name = '';
    27	  if (suit === 'wind') {
    28	    const windNames = { 1: '东', 2: '南', 3: '西', 4: '北' };
    29	    name = windNames[value] || '';
    30	  } else if (suit === 'dragon') {
    31	    const dragonNames = { 1: '中', 2: '发', 3: '白' };
    32	    name = dragonNames[value] || '';
    33	  } else {
    34	    name = `${value}${suitNames[suit]}`;
    35	  }
    36	  return {
    37	    id: `${suit}_${value}_${Math.random().toString(36).substr(2, 9)}`,
    38	    suit,
    39	    value,
    40	    name
    41	  };
    42	}
    43	
    44	function createFullDeck() {
    45	  const deck = [];
    46	  // 万、筒、条（各1-9，各4张）
    47	  ['wan', 'tong', 'tiao'].forEach(suit => {
    48	    for (let value = 1; value <= 9; value++) {
    49	      for (let i = 0; i < 4; i++) {
    50	        deck.push(createTile(suit, value));
    51	      }
    52	    }
    53	  });
    54	  // 风牌（东南西北，各4张）
    55	  for (let value = 1; value <= 4; value++) {
    56	    for (let i = 0; i < 4; i++) {
    57	      deck.push(createTile('wind', value));
    58	    }
    59	  }
    60	  // 箭牌（中发白，各4张）
    61	  for (let value = 1; value <= 3; value++) {
    62	    for (let i = 0; i < 4; i++) {
    63	      deck.push(createTile('dragon', value));
    64	    }
    65	  }
    66	  return shuffleDeck(deck);
    67	}
    68	
    69	function shuffleDeck(deck) {
    70	  const shuffled = [...deck];
    71	  for (let i = shuffled.length - 1; i > 0; i--) {
    72	    const j = Math.floor(Math.random() * (i + 1));
    73	    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    74	  }
    75	  return shuffled;
    76	}
    77	
    78	function isSameTile(tile1, tile2) {
    79	  return tile1.suit === tile2.suit && tile1.value === tile2.value;
    80	}
    81	
    82	function isLaiZi(tile, laiZiTile) {
    83	  if (!laiZiTile) return false;
    84	  return isSameTile(tile, laiZiTile);
    85	}
    86	
    87	function getLaiZiCount(tiles, laiZiTile) {
    88	  if (!laiZiTile) return 0;
    89	  return tiles.filter(tile => isLaiZi(tile, laiZiTile)).length;
    90	}
    91	
    92	function sortTiles(tiles) {
    93	  const suitOrder = { wan: 0, tong: 1, tiao: 2, wind: 3, dragon: 4 };
    94	  return [...tiles].sort((a, b) => {
    95	    const suitDiff = suitOrder[a.suit] - suitOrder[b.suit];
    96	    if (suitDiff !== 0) return suitDiff;
    97	    return a.value - b.value;
    98	  });
    99	}
   100	
   101	// ==================== 胡牌判断 ====================
   102	function canHu(handTiles, chiPengTiles, targetTile, laiZiTile) {
   103	  const allTiles = [...handTiles, targetTile];
   104	  const laiZiCount = getLaiZiCount(allTiles, laiZiTile);
   105	  
   106	  // 检查七小对
   107	  if (isQiXiaoDui(allTiles, laiZiTile)) {
   108	    return { canHu: true, huType: 'qixiaodui', laiZiCount };
   109	  }
   110	  
   111	  // 检查十三不靠
   112	  if (isShiSanBuKao(allTiles, laiZiTile)) {
   113	    return { canHu: true, huType: 'shisanbukao', laiZiCount };
   114	  }
   115	  
   116	  // 检查对对胡
   117	  if (isDuiDuiHu(allTiles, chiPengTiles, laiZiTile)) {
   118	    return { canHu: true, huType: 'duiduihu', laiZiCount };
   119	  }
   120	  
   121	  // 检查平胡
   122	  if (isPingHu(allTiles, chiPengTiles, laiZiTile)) {
   123	    return { canHu: true, huType: 'pinghu', laiZiCount };
   124	  }
   125	  
   126	  return { canHu: false, laiZiCount };
   127	}
   128	
   129	function isQiXiaoDui(tiles, laiZiTile) {
   130	  if (tiles.length !== 14) return false;
   131	  const normalTiles = tiles.filter(t => !isLaiZi(t, laiZiTile));
   132	  const laiZiCount = tiles.length - normalTiles.length;
   133	  
   134	  const tileCounts = new Map();
   135	  for (const tile of normalTiles) {
   136	    const key = `${tile.suit}-${tile.value}`;
   137	    tileCounts.set(key, (tileCounts.get(key) || 0) + 1);
   138	  }
   139	  
   140	  let pairs = 0;
   141	  let singles = 0;
   142	  
   143	  for (const count of tileCounts.values()) {
   144	    if (count === 2) pairs++;
   145	    else if (count === 1) singles++;
   146	    else if (count === 4) pairs += 2;
   147	    else if (count === 3) { pairs++; singles++; }
   148	  }
   149	  
   150	  const neededLaiZi = Math.ceil(singles / 2);
   151	  return pairs + neededLaiZi === 7 && laiZiCount >= neededLaiZi;
   152	}
   153	
   154	function isShiSanBuKao(tiles, laiZiTile) {
   155	  if (tiles.length !== 14) return false;
   156	  const normalTiles = tiles.filter(t => !isLaiZi(t, laiZiTile));
   157	  const laiZiCount = tiles.length - normalTiles.length;
   158	  
   159	  const neededSets = [
   160	    new Set([1, 4, 7]), // wan
   161	    new Set([1, 4, 7]), // tong
   162	    new Set([1, 4, 7]), // tiao
   163	    new Set([1, 2, 3, 4]), // wind
   164	    new Set([1, 2, 3]) // dragon
   165	  ];
   166	  
   167	  let counts = { wan: 0, tong: 0, tiao: 0, wind: 0, dragon: 0 };
   168	  
   169	  for (const tile of normalTiles) {
   170	    if (tile.suit === 'wan' && neededSets[0].has(tile.value)) counts.wan++;
   171	    else if (tile.suit === 'tong' && neededSets[1].has(tile.value)) counts.tong++;
   172	    else if (tile.suit === 'tiao' && neededSets[2].has(tile.value)) counts.tiao++;
   173	    else if (tile.suit === 'wind' && neededSets[3].has(tile.value)) counts.wind++;
   174	    else if (tile.suit === 'dragon' && neededSets[4].has(tile.value)) counts.dragon++;
   175	    else return false;
   176	  }
   177	  
   178	  const missing = (3 - counts.wan) + (3 - counts.tong) + (3 - counts.tiao) + (4 - counts.wind) + (3 - counts.dragon);
   179	  return missing <= laiZiCount;
   180	}
   181	
   182	function isDuiDuiHu(tiles, chiPengTiles, laiZiTile) {
   183	  const normalTiles = tiles.filter(t => !isLaiZi(t, laiZiTile));
   184	  const laiZiCount = tiles.length - normalTiles.length;
   185	  
   186	  const tileCounts = new Map();
   187	  for (const tile of normalTiles) {
   188	    const key = `${tile.suit}-${tile.value}`;
   189	    tileCounts.set(key, (tileCounts.get(key) || 0) + 1);
   190	  }
   191	  
   192	  let kezi = chiPengTiles.length;
   193	  let pairs = 0;
   194	  let neededLaiZi = 0;
   195	  
   196	  for (const count of tileCounts.values()) {
   197	    if (count >= 3) kezi++;
   198	    else if (count === 2) pairs++;
   199	    else if (count === 1) {
   200	      if (laiZiCount >= 2) { neededLaiZi += 2; kezi++; }
   201	      else if (laiZiCount >= 1) { neededLaiZi += 1; pairs++; }
   202	    }
   203	  }
   204	  
   205	  let remainingLaiZi = laiZiCount - neededLaiZi;
   206	  while (kezi < 4 && remainingLaiZi >= 2) { kezi++; remainingLaiZi -= 2; }
   207	  if (pairs === 0 && remainingLaiZi >= 1) { pairs++; remainingLaiZi--; }
   208	  
   209	  return kezi >= 4 && pairs >= 1;
   210	}
   211	
   212	function isPingHu(tiles, chiPengTiles, laiZiTile) {
   213	  const normalTiles = tiles.filter(t => !isLaiZi(t, laiZiTile));
   214	  const laiZiCount = tiles.length - normalTiles.length;
   215	  const neededMelds = 4 - chiPengTiles.length;
   216	  return canFormHu(normalTiles, neededMelds, laiZiCount);
   217	}
   218	
   219	function canFormHu(tiles, neededMelds, laiZiCount) {
   220	  if (tiles.length === 0 && neededMelds === 0) return true;
   221	  if (tiles.length === 0) return false;
   222	  if (neededMelds < 0) return false;
   223	  
   224	  const bySuit = groupBySuit(tiles);
   225	  
   226	  for (const [suit, suitTiles] of bySuit) {
   227	    if (suit === 'wind' || suit === 'dragon') continue;
   228	    
   229	    const counts = countTiles(suitTiles);
   230	    
   231	    for (const [key, count] of counts) {
   232	      if (count >= 2) {
   233	        const remaining = removeTiles(tiles, key, 2);
   234	        if (canFormMelds(remaining, neededMelds, laiZiCount)) return true;
   235	      } else if (count === 1 && laiZiCount >= 1) {
   236	        const remaining = removeTiles(tiles, key, 1);
   237	        if (canFormMelds(remaining, neededMelds, laiZiCount - 1)) return true;
   238	      }
   239	    }
   240	  }
   241	  
   242	  return false;
   243	}
   244	
   245	function canFormMelds(tiles, neededMelds, laiZiCount) {
   246	  if (neededMelds === 0) return tiles.length === 0;
   247	  if (tiles.length === 0) return false;
   248	  if (tiles.length > neededMelds * 3 + laiZiCount) return false;
   249	  
   250	  const bySuit = groupBySuit(tiles);
   251	  
   252	  for (const [suit, suitTiles] of bySuit) {
   253	    const counts = countTiles(suitTiles);
   254	    
   255	    for (const [key, count] of counts) {
   256	      const value = parseInt(key.split('-')[1]);
   257	      
   258	      if (count >= 3) {
   259	        const remaining = removeTiles(tiles, key, 3);
   260	        if (canFormMelds(remaining, neededMelds - 1, laiZiCount)) return true;
   261	      }
   262	      
   263	      if (suit !== 'wind' && suit !== 'dragon' && value <= 7) {
   264	        const key1 = `${suit}-${value + 1}`;
   265	        const key2 = `${suit}-${value + 2}`;
   266	        const count1 = counts.get(key1) || 0;
   267	        const count2 = counts.get(key2) || 0;
   268	        
   269	        if (count >= 1 && count1 >= 1 && count2 >= 1) {
   270	          let remaining = removeTiles(tiles, key, 1);
   271	          remaining = removeTiles(remaining, key1, 1);
   272	          remaining = removeTiles(remaining, key2, 1);
   273	          if (canFormMelds(remaining, neededMelds - 1, laiZiCount)) return true;
   274	        }
   275	        
   276	        const neededLaiZi = (count >= 1 ? 0 : 1) + (count1 >= 1 ? 0 : 1) + (count2 >= 1 ? 0 : 1);
   277	        if (laiZiCount >= neededLaiZi) {
   278	          let remaining = [...tiles];
   279	          if (count >= 1) remaining = removeTiles(remaining, key, 1);
   280	          if (count1 >= 1) remaining = removeTiles(remaining, key1, 1);
   281	          if (count2 >= 1) remaining = removeTiles(remaining, key2, 1);
   282	          if (canFormMelds(remaining, neededMelds - 1, laiZiCount - neededLaiZi)) return true;
   283	        }
   284	      }
   285	      
   286	      if (count >= 2 && laiZiCount >= 1) {
   287	        const remaining = removeTiles(tiles, key, 2);
   288	        if (canFormMelds(remaining, neededMelds - 1, laiZiCount - 1)) return true;
   289	      }
   290	      if (count >= 1 && laiZiCount >= 2) {
   291	        const remaining = removeTiles(tiles, key, 1);
   292	        if (canFormMelds(remaining, neededMelds - 1, laiZiCount - 2)) return true;
   293	      }
   294	    }
   295	  }
   296	  
   297	  return false;
   298	}
   299	
   300	function groupBySuit(tiles) {
   301	  const map = new Map();
   302	  for (const tile of tiles) {
   303	    if (!map.has(tile.suit)) map.set(tile.suit, []);
   304	    map.get(tile.suit).push(tile);
   305	  }
   306	  return map;
   307	}
   308	
   309	function countTiles(tiles) {
   310	  const counts = new Map();
   311	  for (const tile of tiles) {
   312	    const key = `${tile.suit}-${tile.value}`;
   313	    counts.set(key, (counts.get(key) || 0) + 1);
   314	  }
   315	  return counts;
   316	}
   317	
   318	function removeTiles(tiles, key, count) {
   319	  const result = [...tiles];
   320	  let removed = 0;
   321	  for (let i = 0; i < result.length && removed < count; i++) {
   322	    const tileKey = `${result[i].suit}-${result[i].value}`;
   323	    if (tileKey === key) {
   324	      result.splice(i, 1);
   325	      removed++;
   326	      i--;
   327	    }
   328	  }
   329	  return result;
   330	}
   331	
   332	function canChi(tiles, targetTile, playerPosition, dealerPosition) {
   333	  const result = [];
   334	  const expectedPosition = (dealerPosition + 3) % 4;
   335	  if (playerPosition !== expectedPosition) return result;
   336	  if (targetTile.suit === 'wind' || targetTile.suit === 'dragon') return result;
   337	  
   338	  const suit = targetTile.suit;
   339	  const value = targetTile.value;
   340	  
   341	  if (value >= 3) {
   342	    const tile1 = tiles.find(t => t.suit === suit && t.value === value - 2);
   343	    const tile2 = tiles.find(t => t.suit === suit && t.value === value - 1);
   344	    if (tile1 && tile2) result.push([tile1, tile2, targetTile]);
   345	  }
   346	  
   347	  if (value >= 2 && value <= 8) {
   348	    const tile1 = tiles.find(t => t.suit === suit && t.value === value - 1);
   349	    const tile2 = tiles.find(t => t.suit === suit && t.value === value + 1);
   350	    if (tile1 && tile2) result.push([tile1, targetTile, tile2]);
   351	  }
   352	  
   353	  if (value <= 7) {
   354	    const tile1 = tiles.find(t => t.suit === suit && t.value === value + 1);
   355	    const tile2 = tiles.find(t => t.suit === suit && t.value === value + 2);
   356	    if (tile1 && tile2) result.push([targetTile, tile1, tile2]);
   357	  }
   358	  
   359	  return result;
   360	}
   361	
   362	function canPeng(tiles, targetTile) {
   363	  const sameTiles = tiles.filter(t => isSameTile(t, targetTile));
   364	  if (sameTiles.length >= 2) return [sameTiles[0], sameTiles[1], targetTile];
   365	  return null;
   366	}
   367	
   368	function canMingGang(tiles, targetTile) {
   369	  const sameTiles = tiles.filter(t => isSameTile(t, targetTile));
   370	  if (sameTiles.length >= 3) return [sameTiles[0], sameTiles[1], sameTiles[2], targetTile];
   371	  return null;
   372	}
   373	
   374	function canAnGang(tiles, laiZiTile) {
   375	  const result = [];
   376	  const checked = new Set();
   377	  
   378	  for (const tile of tiles) {
   379	    const key = `${tile.suit}-${tile.value}`;
   380	    if (checked.has(key)) continue;
   381	    checked.add(key);
   382	    if (isLaiZi(tile, laiZiTile)) continue;
   383	    
   384	    const sameTiles = tiles.filter(t => isSameTile(t, tile));
   385	    if (sameTiles.length === 4) result.push(sameTiles);
   386	  }
   387	  
   388	  return result;
   389	}
   390	
   391	// ==================== 游戏逻辑 ====================
   392	function initGame(room) {
   393	  const deck = createFullDeck();
   394	  const players = room.players;
   395	  const tilesPerPlayer = 13;
   396	  const totalDealt = tilesPerPlayer * players.length;
   397	  
   398	  // 发牌
   399	  for (let i = 0; i < players.length; i++) {
   400	    players[i].handTiles = sortTiles(deck.slice(i * tilesPerPlayer, (i + 1) * tilesPerPlayer));
   401	    players[i].playedTiles = [];
   402	    players[i].chiPengTiles = [];
   403	    players[i].gangTiles = [];
   404	    players[i].isReady = false;
   405	  }
   406	  
   407	  // 癞子
   408	  const laiZiIndex = totalDealt;
   409	  const laiZiTile = deck[laiZiIndex];
   410	  
   411	  // 牌墙
   412	  const wallTiles = deck.slice(laiZiIndex + 1);
   413	  
   414	  // 随机庄家
   415	  const dealer = Math.floor(Math.random() * players.length);
   416	  
   417	  return {
   418	    phase: 'playing',
   419	    currentPlayer: dealer,
   420	    dealer,
   421	    lianZhuangCount: room.lianZhuangCount || 0,
   422	    wallTiles,
   423	    discardedTiles: [],
   424	    laiZiTile,
   425	    round: (room.gameState?.round || 0) + 1,
   426	    actions: [],
   427	    lastPlayedTile: null,
   428	    lastAction: null
   429	  };
   430	}
   431	
   432	function drawTile(gameState, player) {
   433	  if (gameState.wallTiles.length === 0) return { success: false, error: '牌墙已空' };
   434	  if (gameState.wallTiles.length <= 17) return { success: false, error: '流局' };
   435	  
   436	  const tile = gameState.wallTiles.shift();
   437	  player.handTiles.push(tile);
   438	  player.handTiles = sortTiles(player.handTiles);
   439	  
   440	  gameState.actions.push({
   441	    type: 'draw',
   442	    playerId: player.id,
   443	    tiles: [tile],
   444	    timestamp: Date.now()
   445	  });
   446	  
   447	  return { success: true, tile };
   448	}
   449	
   450	function playTile(gameState, player, tileId) {
   451	  const tileIndex = player.handTiles.findIndex(t => t.id === tileId);
   452	  if (tileIndex === -1) return { success: false, error: '手牌中没有这张牌' };
   453	  
   454	  const tile = player.handTiles[tileIndex];
   455	  player.handTiles.splice(tileIndex, 1);
   456	  gameState.discardedTiles.push(tile);
   457	  player.playedTiles.push(tile);
   458	  
   459	  const action = {
   460	    type: 'play',
   461	    playerId: player.id,
   462	    tiles: [tile],
   463	    timestamp: Date.now()
   464	  };
   465	  gameState.actions.push(action);
   466	  gameState.lastPlayedTile = tile;
   467	  gameState.lastAction = action;
   468	  
   469	  return { success: true, action };
   470	}
   471	
   472	function doChi(gameState, player, tiles, targetTile) {
   473	  const chiPengCount = player.chiPengTiles.filter(group => group.length === 3).length;
   474	  if (chiPengCount >= 2) return { success: false, error: '吃碰次数已达上限' };
   475	  
   476	  for (const tile of tiles) {
   477	    if (isSameTile(tile, targetTile)) continue;
   478	    const index = player.handTiles.findIndex(t => t.id === tile.id);
   479	    if (index !== -1) player.handTiles.splice(index, 1);
   480	  }
   481	  
   482	  player.chiPengTiles.push([...tiles]);
   483	  
   484	  const discardIndex = gameState.discardedTiles.findIndex(t => t.id === targetTile.id);
   485	  if (discardIndex !== -1) gameState.discardedTiles.splice(discardIndex, 1);
   486	  
   487	  gameState.actions.push({
   488	    type: 'chi',
   489	    playerId: player.id,
   490	    tiles: [...tiles],
   491	    targetTile,
   492	    timestamp: Date.now()
   493	  });
   494	  
   495	  return { success: true };
   496	}
   497	
   498	function doPeng(gameState, player, tiles, targetTile) {
   499	  const chiPengCount = player.chiPengTiles.filter(group => group.length === 3).length;
   500	  if (chiPengCount >= 2) return { success: false, error: '吃碰次数已达上限' };   501	  
   502	  for (const tile of tiles) {
   503	    if (isSameTile(tile, targetTile)) continue;
   504	    const index = player.handTiles.findIndex(t => t.id === tile.id);
   505	    if (index !== -1) player.handTiles.splice(index, 1);
   506	  }
   507	  
   508	  player.chiPengTiles.push([...tiles]);
   509	  
   510	  const discardIndex = gameState.discardedTiles.findIndex(t => t.id === targetTile.id);
   511	  if (discardIndex !== -1) gameState.discardedTiles.splice(discardIndex, 1);
   512	  
   513	  gameState.actions.push({
   514	    type: 'peng',
   515	    playerId: player.id,
   516	    tiles: [...tiles],
   517	    targetTile,
   518	    timestamp: Date.now()
   519	  });
   520	  
   521	  return { success: true };
   522	}
   523	
   524	function doGang(gameState, player, tiles, targetTile, isAnGang) {
   525	  if (isAnGang) {
   526	    for (const tile of tiles) {
   527	      const index = player.handTiles.findIndex(t => t.id === tile.id);
   528	      if (index !== -1) player.handTiles.splice(index, 1);
   529	    }
   530	  } else {
   531	    for (const tile of tiles) {
   532	      if (isSameTile(tile, targetTile)) continue;
   533	      const index = player.handTiles.findIndex(t => t.id === tile.id);
   534	      if (index !== -1) player.handTiles.splice(index, 1);
   535	    }
   536	    const discardIndex = gameState.discardedTiles.findIndex(t => t.id === targetTile.id);
   537	    if (discardIndex !== -1) gameState.discardedTiles.splice(discardIndex, 1);
   538	  }
   539	  
   540	  player.gangTiles.push([...tiles]);
   541	  
   542	  gameState.actions.push({
   543	    type: 'gang',
   544	    playerId: player.id,
   545	    tiles: [...tiles],
   546	    targetTile,
   547	    timestamp: Date.now()
   548	  });
   549	  
   550	  return { success: true };
   551	}
   552	
   553	function doHu(gameState, players, winner, targetTile, isZiMo, playedPlayerId) {
   554	  const huResult = canHu(winner.handTiles, winner.chiPengTiles, targetTile, gameState.laiZiTile);
   555	  if (!huResult.canHu) return [];
   556	  
   557	  const laiZiCount = huResult.laiZiCount;
   558	  const lianZhuangCount = gameState.lianZhuangCount;
   559	  
   560	  // 基础分数
   561	  let baseScore = 8;
   562	  if (laiZiCount === 1) baseScore = 7;
   563	  else if (laiZiCount === 2) baseScore = 8;
   564	  else if (laiZiCount >= 3) baseScore = 9;
   565	  
   566	  // 连庄加分
   567	  baseScore += 5 * lianZhuangCount;
   568	  
   569	  const results = [];
   570	  
   571	  if (isZiMo) {
   572	    for (const player of players) {
   573	      if (player.id === winner.id) {
   574	        player.score += baseScore * 2 * 3;
   575	      } else {
   576	        player.score -= baseScore * 2;
   577	      }
   578	    }
   579	    
   580	    results.push({
   581	      winnerId: winner.id,
   582	      huType: huResult.huType,
   583	      baseScore,
   584	      laiZiCount,
   585	      totalScore: baseScore * 2 * 3,
   586	      isZiMo: true,
   587	      details: `自摸${huResult.huType}，获得${baseScore * 2 * 3}分`
   588	    });
   589	  } else {
   590	    const loser = players.find(p => p.id === playedPlayerId);
   591	    if (loser) {
   592	      loser.score -= baseScore * 2;
   593	      
   594	      for (const player of players) {
   595	        if (player.id !== winner.id && player.id !== loser.id) {
   596	          player.score -= baseScore;
   597	        }
   598	      }
   599	      
   600	      const totalScore = baseScore * 2 + baseScore * 2;
   601	      winner.score += totalScore;
   602	      
   603	      results.push({
   604	        winnerId: winner.id,
   605	        loserId: loser.id,
   606	        huType: huResult.huType,
   607	        baseScore,
   608	        laiZiCount,
   609	        totalScore,
   610	        isZiMo: false,
   611	        details: `胡${loser.nickname}的${huResult.huType}，获得${totalScore}分`
   612	      });
   613	    }
   614	  }
   615	  
   616	  gameState.huResults = results;
   617	  gameState.phase = 'settled';
   618	  
   619	  return results;
   620	}
   621	
   622	// ==================== Socket事件处理 ====================
   623	io.on('connection', (socket) => {
   624	  console.log('用户连接:', socket.id);
   625	  
   626	  // 创建房间
   627	  socket.on('create_room', ({ roomName, player, maxPlayers = 4, customRoomId }) => {
   628	    const roomId = customRoomId?.trim() || 'room_' + Date.now().toString(36).substr(2, 8).toUpperCase();
   629	    
   630	    if (rooms.has(roomId)) {
   631	      socket.emit('connect_error', '房间号已存在');
   632	      return;
   633	    }
   634	    
   635	    const room = {
   636	      id: roomId,
   637	      name: roomName,
   638	      players: [{ ...player, position: 0, socketId: socket.id, isReady: false }],
   639	      maxPlayers,
   640	      hostId: player.id,
   641	      createdAt: Date.now(),
   642	      voiceEnabled: false,
   643	      lianZhuangCount: 0
   644	    };
   645	    
   646	    rooms.set(roomId, room);
   647	    playerSockets.set(player.id, socket.id);
   648	    socket.join(roomId);
   649	    
   650	    console.log('创建房间:', roomId, roomName);
   651	    socket.emit('room_updated', room);
   652	    io.emit('room_list', Array.from(rooms.values()));
   653	  });
   654	  
   655	  // 加入房间
   656	  socket.on('join_room', ({ roomId, player }) => {
   657	    console.log('加入房间请求:', roomId, '玩家:', player.nickname);
   658	    
   659	    const room = rooms.get(roomId);
   660	    if (!room) {
   661	      console.log('房间不存在:', roomId);
   662	      socket.emit('connect_error', '房间不存在');
   663	      return;
   664	    }
   665	    
   666	    // 检查玩家是否已经在房间中
   667	    const existingPlayerIndex = room.players.findIndex(p => p.id === player.id);
   668	    if (existingPlayerIndex >= 0) {
   669	      // 更新socketId
   670	      room.players[existingPlayerIndex].socketId = socket.id;
   671	      playerSockets.set(player.id, socket.id);
   672	      socket.join(roomId);
   673	      socket.emit('room_updated', room);
   674	      console.log('玩家重新加入房间:', roomId, player.nickname);
   675	      return;
   676	    }
   677	    
   678	    if (room.players.length >= room.maxPlayers) {
   679	      socket.emit('connect_error', '房间已满');
   680	      return;
   681	    }
   682	    
   683	    const position = room.players.length;
   684	    const newPlayer = { ...player, position, socketId: socket.id, isReady: false };
   685	    room.players.push(newPlayer);
   686	    playerSockets.set(player.id, socket.id);
   687	    
   688	    socket.join(roomId);
   689	    
   690	    console.log('玩家加入房间:', roomId, player.nickname, '当前人数:', room.players.length);
   691	    
   692	    io.to(roomId).emit('room_updated', room);
   693	    io.to(roomId).emit('player_joined', newPlayer);
   694	    io.emit('room_list', Array.from(rooms.values()));
   695	  });
   696	  
   697	  // 离开房间
   698	  socket.on('leave_room', ({ roomId }) => {
   699	    const room = rooms.get(roomId);
   700	    if (!room) return;
   701	    
   702	    const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
   703	    if (playerIndex !== -1) {
   704	      const player = room.players[playerIndex];
   705	      room.players.splice(playerIndex, 1);
   706	      playerSockets.delete(player.id);
   707	      
   708	      console.log('玩家离开房间:', roomId, player.nickname);
   709	      
   710	      if (room.players.length === 0) {
   711	        rooms.delete(roomId);
   712	        console.log('房间已删除:', roomId);
   713	      } else {
   714	        if (room.hostId === player.id && room.players.length > 0) {
   715	          room.hostId = room.players[0].id;
   716	        }
   717	        // 更新位置
   718	        room.players.forEach((p, i) => { p.position = i; });
   719	        io.to(roomId).emit('player_left', player.id);
   720	        io.to(roomId).emit('room_updated', room);
   721	      }
   722	    }
   723	    
   724	    socket.leave(roomId);
   725	    io.emit('room_list', Array.from(rooms.values()));
   726	  });
   727	  
   728	  // 玩家准备
   729	  socket.on('player_ready', ({ roomId, playerId }) => {
   730	    const room = rooms.get(roomId);
   731	    if (!room) return;
   732	    
   733	    const player = room.players.find(p => p.id === playerId);
   734	    if (player) {
   735	      player.isReady = true;
   736	      io.to(roomId).emit('room_updated', room);
   737	    }
   738	  });
   739	  
   740	  // 开始游戏
   741	  socket.on('start_game', ({ roomId }) => {
   742	    const room = rooms.get(roomId);
   743	    if (!room) return;
   744	    
   745	    const gameState = initGame(room);
   746	    room.gameState = gameState;
   747	    
   748	    console.log('游戏开始:', roomId, '庄家:', gameState.dealer);
   749	    
   750	    io.to(roomId).emit('game_started', { room, gameState });
   751	  });
   752	  
   753	  // 摸牌
   754	  socket.on('draw_tile', ({ roomId, playerId }) => {
   755	    const room = rooms.get(roomId);
   756	    if (!room || !room.gameState) return;
   757	    
   758	    const player = room.players.find(p => p.id === playerId);
   759	    if (!player) return;
   760	    
   761	    const result = drawTile(room.gameState, player);
   762	    if (result.success) {
   763	      io.to(roomId).emit('game_state_updated', { room, gameState: room.gameState });
   764	    }
   765	  });
   766	  
   767	  // 打牌
   768	  socket.on('play_tile', ({ roomId, playerId, tileId }) => {
   769	    const room = rooms.get(roomId);
   770	    if (!room || !room.gameState) return;
   771	    
   772	    const player = room.players.find(p => p.id === playerId);
   773	    if (!player) return;
   774	    
   775	    const result = playTile(room.gameState, player, tileId);
   776	    if (result.success) {
   777	      // 切换到下一个玩家
   778	      room.gameState.currentPlayer = (room.gameState.currentPlayer + 1) % room.players.length;
   779	      io.to(roomId).emit('game_state_updated', { room, gameState: room.gameState });
   780	    }
   781	  });
   782	  
   783	  // 吃
   784	  socket.on('chi', ({ roomId, playerId, tiles, targetTile }) => {
   785	    const room = rooms.get(roomId);
   786	    if (!room || !room.gameState) return;
   787	    
   788	    const player = room.players.find(p => p.id === playerId);
   789	    if (!player) return;
   790	    
   791	    const result = doChi(room.gameState, player, tiles, targetTile);
   792	    if (result.success) {
   793	      io.to(roomId).emit('game_state_updated', { room, gameState: room.gameState });
   794	    }
   795	  });
   796	  
   797	  // 碰
   798	  socket.on('peng', ({ roomId, playerId, tiles, targetTile }) => {
   799	    const room = rooms.get(roomId);
   800	    if (!room || !room.gameState) return;
   801	    
   802	    const player = room.players.find(p => p.id === playerId);
   803	    if (!player) return;
   804	    
   805	    const result = doPeng(room.gameState, player, tiles, targetTile);
   806	    if (result.success) {
   807	      io.to(roomId).emit('game_state_updated', { room, gameState: room.gameState });
   808	    }
   809	  });
   810	  
   811	  // 杠
   812	  socket.on('gang', ({ roomId, playerId, tiles, targetTile, isAnGang }) => {
   813	    const room = rooms.get(roomId);
   814	    if (!room || !room.gameState) return;
   815	    
   816	    const player = room.players.find(p => p.id === playerId);
   817	    if (!player) return;
   818	    
   819	    const result = doGang(room.gameState, player, tiles, targetTile, isAnGang);
   820	    if (result.success) {
   821	      // 杠后摸牌
   822	      drawTile(room.gameState, player);
   823	      io.to(roomId).emit('game_state_updated', { room, gameState: room.gameState });
   824	    }
   825	  });
   826	  
   827	  // 胡
   828	  socket.on('hu', ({ roomId, playerId, targetTile, isZiMo, playedPlayerId }) => {
   829	    const room = rooms.get(roomId);
   830	    if (!room || !room.gameState) return;
   831	    
   832	    const player = room.players.find(p => p.id === playerId);
   833	    if (!player) return;
   834	    
   835	    const results = doHu(room.gameState, room.players, player, targetTile, isZiMo, playedPlayerId);
   836	    if (results.length > 0) {
   837	      // 连庄处理
   838	      if (isZiMo && room.gameState.dealer === room.players.findIndex(p => p.id === playerId)) {
   839	        room.lianZhuangCount++;
   840	      } else {
   841	        room.lianZhuangCount = 0;
   842	      }
   843	      
   844	      io.to(roomId).emit('hu_result', { room, gameState: room.gameState, results });
   845	    }
   846	  });
   847	  
   848	  // 过
   849	  socket.on('pass', ({ roomId }) => {
   850	    const room = rooms.get(roomId);
   851	    if (!room || !room.gameState) return;
   852	    
   853	    room.gameState.currentPlayer = (room.gameState.currentPlayer + 1) % room.players.length;
   854	    io.to(roomId).emit('game_state_updated', { room, gameState: room.gameState });
   855	  });
   856	  
   857	  // 聊天消息
   858	  socket.on('chat_message', ({ roomId, message }) => {
   859	    const room = rooms.get(roomId);
   860	    if (!room) return;
   861	    
   862	    io.to(roomId).emit('chat_message', message);
   863	  });
   864	  
   865	  // 获取房间列表
   866	  socket.on('get_room_list', () => {
   867	    socket.emit('room_list', Array.from(rooms.values()));
   868	  });
   869	  
   870	  // 语音相关
   871	  socket.on('voice_join', ({ roomId, playerId }) => {
   872	    socket.to(roomId).emit('voice_join', { playerId });
   873	  });
   874	  
   875	  socket.on('voice_leave', ({ roomId, playerId }) => {
   876	    socket.to(roomId).emit('voice_leave', { playerId });
   877	  });
   878	  
   879	  socket.on('voice_offer', ({ roomId, targetId, offer }) => {
   880	    const targetSocketId = playerSockets.get(targetId);
   881	    if (targetSocketId) {
   882	      io.to(targetSocketId).emit('voice_offer', { targetId: socket.id, offer });
   883	    }
   884	  });
   885	  
   886	  socket.on('voice_answer', ({ roomId, targetId, answer }) => {
   887	    const targetSocketId = playerSockets.get(targetId);
   888	    if (targetSocketId) {
   889	      io.to(targetSocketId).emit('voice_answer', { targetId: socket.id, answer });
   890	    }
   891	  });
   892	  
   893	  socket.on('voice_ice_candidate', ({ roomId, targetId, candidate }) => {
   894	    const targetSocketId = playerSockets.get(targetId);
   895	    if (targetSocketId) {
   896	      io.to(targetSocketId).emit('voice_ice_candidate', { targetId: socket.id, candidate });
   897	    }
   898	  });
   899	  
   900	  // 断开连接
   901	  socket.on('disconnect', () => {
   902	    console.log('用户断开连接:', socket.id);
   903	    
   904	    // 从所有房间中移除该玩家
   905	    rooms.forEach((room, roomId) => {
   906	      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
   907	      if (playerIndex !== -1) {
   908	        const player = room.players[playerIndex];
   909	        room.players.splice(playerIndex, 1);
   910	        playerSockets.delete(player.id);
   911	        
   912	        console.log('玩家断开，从房间移除:', roomId, player.nickname);
   913	        
   914	        if (room.players.length === 0) {
   915	          rooms.delete(roomId);
   916	          console.log('房间已删除:', roomId);
   917	        } else {
   918	          if (room.hostId === player.id && room.players.length > 0) {
   919	            room.hostId = room.players[0].id;
   920	          }
   921	          // 更新位置
   922	          room.players.forEach((p, i) => { p.position = i; });
   923	          io.to(roomId).emit('player_left', player.id);
   924	          io.to(roomId).emit('room_updated', room);
   925	        }
   926	        
   927	        io.emit('room_list', Array.from(rooms.values()));
   928	      }
   929	    });
   930	  });
   931	});
   932	
   933	// ==================== HTTP路由 ====================
   934	app.get('/', (req, res) => {
   935	  res.json({ 
   936	    status: 'ok', 
   937	    message: '慈溪麻将服务器运行中',
   938	    rooms: rooms.size,
   939	    players: Array.from(rooms.values()).reduce((acc, r) => acc + r.players.length, 0)
   940	  });
   941	});
   942	
   943	app.get('/rooms', (req, res) => {
   944	  res.json(Array.from(rooms.values()));
   945	});
   946	
   947	const PORT = process.env.PORT || 3001;
   948	
   949	httpServer.listen(PORT, () => {
   950	  console.log(`=================================`);
   951	  console.log(`慈溪麻将服务器已启动`);
   952	  console.log(`端口: ${PORT}`);
   953	  console.log(`地址: http://localhost:${PORT}`);
   954	  console.log(`=================================`);
   955	});
   956	