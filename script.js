// --- CONFIGURATION FIREBASE ---
// La variable firebaseConfig est chargée depuis config.js

// Initialiser Firebase
if (typeof firebase !== 'undefined') {
    // Vérification de sécurité
    if (typeof firebaseConfig === 'undefined') {
        console.error("Erreur : La configuration Firebase (config.js) est manquante !");
    } else {
        firebase.initializeApp(firebaseConfig);
    }
} else {
    console.error("Firebase SDK non trouvé !");
}

const auth = typeof firebase !== 'undefined' ? firebase.auth() : null;
const db = typeof firebase !== 'undefined' ? firebase.firestore() : null;
let currentUser = null;

// --- VARIABLES DU JEU ---
let pokemonList = []; 
let gamePool = [];    
let targetPokemon = null; 
let targetWord = "";
let currentGuess = "";
let currentRow = 0;
let isGameOver = false;
let isProcessing = false;
let gameMode = 'daily'; 
let knownLetters = []; 
let fixedLength = 0; 
let activeFilters = []; 
let allGenerations = []; 
let lastPlayedId = null; // Variable pour stocker le dernier Pokémon joué (anti-doublon en aléatoire)

// Variables pour la persistance de l'état (Sauvegarde)
let savedGrid = [];     // Stocke les emojis des lignes validées
let savedGuesses = [];  // Stocke les mots des lignes validées

// Variable pour l'Easter Egg
let logoClickCount = 0;

const maxGuesses = 6;
let wordLength = 0;

// Elements
const statusArea = document.getElementById('status-area');
const menuScreen = document.getElementById('menu-screen');
const gameArea = document.getElementById('game-area');
const genFiltersCont = document.getElementById('gen-filters');
const board = document.getElementById('board');
const messageEl = document.getElementById('message');
const resultImg = document.getElementById('pokemon-result-image'); // Image résultat

const restartBtn = document.getElementById('restart-btn');
const giveupBtn = document.getElementById('giveup-btn');
const menuReturnBtn = document.getElementById('menu-return-btn');
const btnDailyStart = document.getElementById('btn-daily-start');

// NOUVEAU : Référence au bouton de partage
const shareBtn = document.getElementById('share-btn');

const keyboardCont = document.getElementById('keyboard-cont');
const modeBadge = document.getElementById('mode-badge');

const hintGen = document.getElementById('hint-gen');
const lblGen = document.getElementById('lbl-gen');
const hintStage = document.getElementById('hint-stage');
const hintType = document.getElementById('hint-type');
const valGen = document.getElementById('val-gen');
const valStage = document.getElementById('val-stage');
const valType = document.getElementById('val-type');

// Popup
const genPopup = document.getElementById('gen-popup');
const genImg = document.getElementById('gen-img');

const keyboardLayout = ["AZERTYUIOP", "QSDFGHJKLM", "WXCVBN"];

// --- GESTION SAUVEGARDE ET FERMETURE ---

// Sauvegarder l'état actuel (appelé quand on quitte ou à chaque action importante)
function saveDailyState() {
    if (gameMode !== 'daily' || !targetPokemon) return;

    const todayKey = getTodayDateKey();
    
    // Construction de l'objet de sauvegarde
    const gameState = {
        status: isGameOver ? 'completed' : 'in-progress',
        targetId: targetPokemon.id,
        currentRow: currentRow,
        currentGuess: currentGuess, // Le mot en cours de frappe
        grid: savedGrid,
        guesses: savedGuesses,
        won: isGameOver && messageEl.textContent.includes("Bravo"), // Simplifié
        attempts: currentRow + (isGameOver && messageEl.textContent.includes("Bravo") ? 0 : 0) // Ajusté à la fin
    };

    if (isGameOver) {
        gameState.attempts = currentRow + 1; // Si fini, on fige le nombre d'essais
    }

    localStorage.setItem('tusmon_daily_' + todayKey, JSON.stringify(gameState));
}

// Écouteur pour la fermeture de l'onglet ou du navigateur
window.addEventListener('beforeunload', () => {
    if (gameMode === 'daily' && !isGameOver) {
        saveDailyState();
    }
});

// --- GESTION FIREBASE (AUTH & LEADERBOARD) ---

// 1. Connexion Twitter
function loginWithTwitter() {
    if (!auth) return;
    const provider = new firebase.auth.TwitterAuthProvider();
    auth.signInWithPopup(provider)
        .then((result) => {
            const twitterHandle = result.additionalUserInfo?.username;
            if(twitterHandle) {
                 const newDisplayName = '@' + twitterHandle;
                 result.user.updateProfile({ displayName: newDisplayName }).then(() => {
                     result.user.displayName = newDisplayName; 
                     currentUser = result.user; 
                     updateAuthUI(result.user);
                     loadLeaderboard(); 
                 }).catch((error) => {
                     console.error("Erreur maj nom:", error);
                     updateAuthUI(result.user);
                     loadLeaderboard();
                 });
            } else {
                updateAuthUI(result.user);
                loadLeaderboard();
            }
        }).catch((error) => {
            console.error(error);
            alert("Erreur de connexion Twitter : " + error.message);
        });
}

// 2. Mise à jour de l'interface de connexion
function updateAuthUI(user) {
    currentUser = user;
    const btnLogin = document.getElementById('btn-twitter-login');
    const txtInfo = document.getElementById('user-info');
    
    // Référence au conteneur du bouton admin
    const adminSection = document.getElementById('admin-section');

    if (user) {
        const handle = user.displayName || "Joueur";
        btnLogin.style.display = 'none';
        txtInfo.style.display = 'block';
        txtInfo.innerHTML = `Connecté : <strong>${handle}</strong>`;
        
        // --- LOGIQUE ADMIN ---
        // Vérifie si le handle correspond exactement à celui attendu
        if (handle === '@suedlemot') {
            // Affiche le bloc complet contenant le bouton admin
            if (adminSection) adminSection.style.display = 'flex';
        } else {
            if (adminSection) adminSection.style.display = 'none';
        }
        // ---------------------

        const todayKey = getTodayDateKey();
        const storedData = localStorage.getItem('tusmon_daily_' + todayKey);
        
        if (storedData) {
            try {
                const result = JSON.parse(storedData);
                if (result && result.status === 'completed') {
                    console.log("Score local trouvé. Synchronisation...");
                    saveScoreToFirebase(result.won, result.attempts);
                }
            } catch (e) {}
        }
        checkRemoteDailyStatus();
    } else {
        btnLogin.style.display = 'inline-block';
        txtInfo.style.display = 'none';
        
        // Cache la section admin si déconnecté
        if (adminSection) adminSection.style.display = 'none';
    }
}

// --- AJOUT : GESTION DU PANEL ADMIN ---
function showAdminPanel() {
    // Cache le menu, Affiche le panel admin en flex (pour centrer)
    document.getElementById('menu-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'flex';
}

function closeAdminPanel() {
    // Cache le panel admin, Réaffiche le menu
    document.getElementById('admin-screen').style.display = 'none';
    document.getElementById('menu-screen').style.display = 'flex';
}

// FONCTION UTILITAIRE : Vérifier si le joueur a déjà un score sur le serveur
function checkRemoteDailyStatus() {
    if (!currentUser || !db) return;
    
    const todayKey = getTodayDateKey();
    const btnDaily = document.getElementById('btn-daily-start');

    db.collection('daily_scores').doc(todayKey).collection('players').doc(currentUser.uid).get()
    .then((docSnapshot) => {
        if (docSnapshot.exists) {
            console.log("Score distant trouvé. Blocage du bouton jouer.");
            if (btnDaily) {
                btnDaily.disabled = true;
                btnDaily.textContent = "DÉJÀ JOUÉ"; 
                // On met à jour le local storage pour refléter que c'est fini
                if (!localStorage.getItem('tusmon_daily_' + todayKey)) {
                     localStorage.setItem('tusmon_daily_' + todayKey, JSON.stringify({status: 'completed', remote: true}));
                }
            }
        }
    }).catch(err => console.error("Erreur vérif score distant:", err));
}

// 3. Charger le Leaderboard
function loadLeaderboard() {
    if (!db) return;

    const leaderboardSection = document.getElementById('leaderboard-section');
    if (leaderboardSection) {
        const titleEl = leaderboardSection.querySelector('.menu-title');
        if (titleEl) {
            titleEl.textContent = "Classement du Jour 🏆";
            const now = new Date();
            const options = { weekday: 'long', day: 'numeric', month: 'long' };
            let dateStr = now.toLocaleDateString('fr-FR', options);
            dateStr = dateStr.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

            let dateEl = document.getElementById('leaderboard-date-subtitle');
            if (!dateEl) {
                dateEl = document.createElement('div');
                dateEl.id = 'leaderboard-date-subtitle';
                dateEl.style.fontWeight = 'normal';
                dateEl.style.fontSize = '0.95rem';
                dateEl.style.color = '#ddd'; 
                dateEl.style.textAlign = 'center';
                dateEl.style.marginTop = '-5px'; 
                dateEl.style.marginBottom = '10px';
                titleEl.parentNode.insertBefore(dateEl, titleEl.nextSibling);
            }
            dateEl.textContent = dateStr;
        }
    }

    const dateKey = getTodayDateKey();
    const leaderboardDiv = document.getElementById('leaderboard-container');
    
    db.collection('daily_scores').doc(dateKey).collection('players')
        .orderBy('won', 'desc') 
        .orderBy('attempts', 'asc') 
        .orderBy('timestamp', 'asc') 
        .limit(5)
        .get()
        .then((querySnapshot) => {
            if (querySnapshot.empty) {
                leaderboardDiv.innerHTML = '<p style="text-align:center; color:#888;">Soyez le premier à gagner !</p>';
                return;
            }

            let html = '<table>';
            let rank = 1;
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                let scoreDisplay = data.won ? `${data.attempts} essai${data.attempts > 1 ? 's' : ''}` : "Perdu";
                const color = data.won ? '#538d4e' : '#d9534f';
                const styles = (currentUser && currentUser.uid === doc.id) ? 'font-weight:bold; color:#fff;' : 'color:#ccc;';
                
                const imgHtml = data.photoURL 
                    ? `<img src="${data.photoURL}" class="profile-pic" alt="pic">` 
                    : `<div class="profile-pic" style="background:#444; display:inline-block; width:24px; height:24px; border-radius:50%;"></div>`;
                
                let crownHtml = rank === 1 ? '<span class="crown-emoji">👑</span>' : '';
                let userLink = data.handle || 'Anonyme';
                if (data.handle && data.handle.startsWith('@')) {
                    const twitterUser = data.handle.substring(1);
                    userLink = `<a href="https://twitter.com/${twitterUser}" target="_blank" style="color: inherit; text-decoration: none; hover:text-decoration: underline;">${data.handle}</a>`;
                }

                html += `<tr style="${styles}">
                            <td style="width:20px;">#${rank}</td>
                            <td><div class="user-cell"><div class="profile-pic-wrapper">${imgHtml}${crownHtml}</div><span>${userLink}</span></div></td>
                            <td style="text-align:right; color:${color}">${scoreDisplay}</td>
                         </tr>`;
                rank++;
            });
            html += '</table>';
            leaderboardDiv.innerHTML = html;
        })
        .catch((error) => {
            console.error("Erreur leaderboard:", error);
            leaderboardDiv.innerHTML = '<p style="text-align:center; color:#d9534f;">Erreur chargement...</p>';
        });
}

function saveScoreToFirebase(won, attempts) {
    if (!currentUser || !db) return;
    const dateKey = getTodayDateKey();
    const userHandle = currentUser.displayName || "Joueur";
    const userPhoto = currentUser.photoURL || null;
    
    const userScoreRef = db.collection('daily_scores').doc(dateKey).collection('players').doc(currentUser.uid);

    userScoreRef.get().then((docSnapshot) => {
        if (!docSnapshot.exists) {
            userScoreRef.set({
                handle: userHandle,
                photoURL: userPhoto,
                attempts: attempts,
                won: won,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
                loadLeaderboard(); 
                checkRemoteDailyStatus();
            });
        } else {
            loadLeaderboard();
            checkRemoteDailyStatus();
        }
    });
}


// --- INIT ---
window.addEventListener('DOMContentLoaded', () => {
    initKeyboard();

    if (auth) {
        auth.onAuthStateChanged((user) => {
            updateAuthUI(user);
            loadLeaderboard(); 
        });
    }

    const btnLogin = document.getElementById('btn-twitter-login');
    if (btnLogin) {
        btnLogin.addEventListener('click', loginWithTwitter);
    }

    fetch('./ressources/Poke DATA.csv')
        .then(response => {
            if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
            return response.text();
        })
        .then(text => parseCSV(text))
        .catch(err => {
            console.error("Erreur:", err);
            statusArea.innerHTML = `Erreur de chargement du fichier CSV.<br>Vérifiez qu'il est présent dans le dossier "ressources".`;
            statusArea.style.color = "#ff4444";
        });
});

function parseCSV(csvText) {
    const lines = csvText.split('\n');
    pokemonList = [];
    const generations = new Set();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
            const parts = line.split(',');
            if (parts.length >= 2) {
                let name = parts[1].trim();
                let normalized = normalizeName(name);
                
                let type = parts[2] ? parts[2].trim() : "?";
                let gen = parts[3] ? parts[3].trim() : "?";
                let stage = parts[4] ? parts[4].trim() : "?";
                let id = parts[0] ? parts[0].trim() : "0"; 

                if (normalized.length >= 3) {
                    pokemonList.push({ 
                        id: id,
                        original: name, 
                        normalized: normalized,
                        gen: gen,
                        stage: stage,
                        type: type
                    });
                    if(gen !== "?") generations.add(gen);
                }
            }
        }
    }

    if (pokemonList.length > 0) {
        allGenerations = Array.from(generations).sort((a, b) => parseInt(a) - parseInt(b));
        statusArea.style.display = 'none';
        initMenu();
    } else {
        statusArea.textContent = "Fichier CSV vide ou invalide.";
    }
}

function initMenu() {
    genFiltersCont.innerHTML = '';
    allGenerations.forEach(gen => {
        const label = document.createElement('label');
        label.className = 'gen-checkbox';
        label.innerHTML = `<input type="checkbox" value="${gen}" checked> Gen ${gen}`;
        genFiltersCont.appendChild(label);
    });
    showMenu();
}

function selectAllGens() {
    const checkboxes = genFiltersCont.querySelectorAll('input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
}

function handleLogoClick() {
    if (menuScreen.style.display !== 'none') {
        logoClickCount++;
        if (logoClickCount > 3) {
            triggerPokeballRain();
            logoClickCount = 0;
        }
    } else {
        showMenu();
    }
}

function showMenu() {
    // Si on est en mode daily et que la partie n'est pas finie, on sauvegarde
    if (gameMode === 'daily' && !isGameOver && targetPokemon) {
        saveDailyState(); // Sauvegarde cruciale avant de quitter l'écran
    }

    gameArea.style.display = 'none';
    menuScreen.style.display = 'flex';
    isGameOver = true; 
    logoClickCount = 0; 
    
    if (gameMode === 'daily') {
        loadLeaderboard();
    }

    const todayKey = getTodayDateKey();
    const storedData = localStorage.getItem('tusmon_daily_' + todayKey);
    
    let hasPlayedDaily = false;
    let isInProgress = false;
    
    if (storedData) {
        try {
            const result = JSON.parse(storedData);
            if (result && result.status === 'completed') {
                hasPlayedDaily = true;
            } else if (result && result.status === 'in-progress') {
                isInProgress = true;
            }
        } catch (e) {}
    }

    if (hasPlayedDaily) {
        btnDailyStart.disabled = true;
        btnDailyStart.textContent = "DÉJÀ JOUÉ AUJOURD'HUI";
    } else if (isInProgress) {
        btnDailyStart.disabled = false;
        btnDailyStart.textContent = "REPRENDRE LA PARTIE";
    } else {
        btnDailyStart.disabled = false;
        btnDailyStart.textContent = "JOUER AU POKÉMON DU JOUR";
    }

    if (currentUser) {
        checkRemoteDailyStatus();
    }
}

function normalizeName(name) {
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
               .replace(/[^a-zA-Z\-\.]/g, "").toUpperCase();
}

function getTodayDateKey() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

// --- ANIMATION PLUIE ---
function triggerFallingItems(content, isImage = false, originElement = null, count = 50) {
    let rect = null;
    if (originElement) {
        rect = originElement.getBoundingClientRect();
    }

    for (let i = 0; i < count; i++) {
        let element;
        if (isImage) {
            element = document.createElement('img');
            element.src = content;
            element.classList.add('falling-item', 'falling-pokeball');
        } else {
            element = document.createElement('div');
            element.textContent = content;
            element.classList.add('falling-item');
            element.style.fontSize = (Math.random() * 1.5 + 1) + 'rem';
        }
        
        if (rect) {
            const randomX = (Math.random() - 0.5) * rect.width; 
            element.style.left = (rect.left + rect.width / 2 + randomX) + 'px';
            element.style.top = (rect.top + rect.height / 2) + 'px';
            const randomDrift = (Math.random() - 0.5) * 300; 
            element.style.setProperty('--fall-x', randomDrift + 'px');
        } else {
            element.style.left = Math.random() * 100 + 'vw';
            element.style.top = '-50px';
            element.style.setProperty('--fall-x', '0px'); 
        }

        element.style.animationDuration = (Math.random() * 2 + 2) + 's';
        element.style.opacity = Math.random();
        
        document.body.appendChild(element);
        setTimeout(() => { element.remove(); }, 5000);
    }
}

function triggerEmojiRain(emojiChar) {
    triggerFallingItems(emojiChar, false, null); 
}

function triggerPokeballRain() {
    const logo = document.querySelector('h1');
    triggerFallingItems('https://upload.wikimedia.org/wikipedia/commons/5/51/Pokebola-pokeball-png-0.png', true, logo, 17);
}

// --- GESTION POPUP IMAGE ---
function showGenPopup() {
    const content = valGen.textContent;
    if (/^\d+$/.test(content)) {
        const genNum = content;
        genImg.src = `./ressources/img/${genNum}.jpg`;
        const rect = hintGen.getBoundingClientRect();
        let leftPos = rect.left + (rect.width / 2) - 225; 
        if (leftPos < 10) leftPos = 10; 
        let topPos = rect.top - 380; 
        if (topPos < 10) topPos = rect.bottom + 10; 
        genPopup.style.left = leftPos + 'px';
        genPopup.style.top = topPos + 'px';
        genPopup.style.display = 'block';
    }
}

function hideGenPopup() {
    genPopup.style.display = 'none';
}

// --- GAME START ---

function startDailyGame() {
    gameMode = 'daily';
    gamePool = [...pokemonList];
    activeFilters = []; 
    const dailyIndex = getDailyPokemonIndex(pokemonList.length);
    targetPokemon = pokemonList[dailyIndex];
    
    // Réinitialisation des états mémoire
    savedGrid = [];
    savedGuesses = [];
    
    const todayKey = getTodayDateKey();
    const storedData = localStorage.getItem('tusmon_daily_' + todayKey);
    let gameData = null;
    let isResuming = false;
    
    if (storedData) {
        try {
            gameData = JSON.parse(storedData);
            if (gameData.status === 'in-progress' && gameData.targetId === targetPokemon.id) {
                isResuming = true;
                console.log("Reprise de la partie quotidienne...");
            }
        } catch (e) {
            console.error("Erreur parsing:", e);
        }
    }

    if (!isResuming) {
        // NOUVELLE PARTIE : On écrase l'ancien localStorage pour être propre
        const initialState = { 
            status: 'in-progress', 
            grid: [],
            guesses: [],
            targetId: targetPokemon.id,
            currentRow: 0,
            currentGuess: ""
        };
        localStorage.setItem('tusmon_daily_' + todayKey, JSON.stringify(initialState));
    }

    setupGameUI(isResuming, gameData);
}

function startRandomGame() {
    gameMode = 'classic';
    const checkboxes = genFiltersCont.querySelectorAll('input[type="checkbox"]:checked');
    const selectedGens = Array.from(checkboxes).map(cb => cb.value);

    if (selectedGens.length === 0) {
        alert("Veuillez sélectionner au moins une génération !");
        return;
    }

    activeFilters = selectedGens; 
    gamePool = pokemonList.filter(p => selectedGens.includes(p.gen));

    if (gamePool.length === 0) {
        alert("Aucun Pokémon trouvé avec ces filtres.");
        return;
    }

    pickRandomPokemon();
    setupGameUI();
}

function pickRandomPokemon() {
    if (gamePool.length <= 1) {
        targetPokemon = gamePool[0];
        return;
    }
    let randomIndex;
    let newPokemon;
    do {
        randomIndex = Math.floor(Math.random() * gamePool.length);
        newPokemon = gamePool[randomIndex];
    } while (newPokemon.id === lastPlayedId);
    targetPokemon = newPokemon;
    lastPlayedId = targetPokemon.id;
}

function getDailyPokemonIndex(listLength) {
    const dateStr = getTodayDateKey();
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
        hash |= 0; 
    }
    hash = Math.abs((hash * 1664525) + 1013904223);
    return hash % listLength;
}

function restartCurrentMode() {
    if (gameMode === 'classic') {
        pickRandomPokemon();
        setupGameUI();
    } else {
        showMenu();
    }
}

function skipToClassic() {
    const checkboxes = genFiltersCont.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    startRandomGame();
}

// --- CONFIGURATION UI ---
function setupGameUI(isResuming = false, gameData = {}) {
    menuScreen.style.display = 'none';
    gameArea.style.display = 'flex';
    keyboardCont.style.display = 'flex';

    isGameOver = false;
    isProcessing = false;
    messageEl.textContent = "";
    resultImg.style.display = "none"; 
    resultImg.src = "";
    
    if (shareBtn) shareBtn.style.display = "none";

    restartBtn.style.display = "none";
    giveupBtn.style.display = "inline-block";
    menuReturnBtn.style.display = "inline-block";
    
    valGen.classList.remove('revealed');
    hintStage.classList.remove('visible');
    hintType.classList.remove('visible');
    
    if (gameMode === 'daily') {
        modeBadge.textContent = "POKÉMON DU JOUR";
        modeBadge.classList.remove('classic');
        lblGen.textContent = "GÉN:";
        valGen.textContent = ""; 
        valGen.style.textTransform = ""; 
        hintGen.classList.remove('visible'); 
    } else {
        modeBadge.textContent = "MODE ALÉATOIRE";
        modeBadge.classList.add('classic');
        lblGen.textContent = "GÉN:";
        const unselected = allGenerations.filter(g => !activeFilters.includes(g));
        let filtersText = "";
        if (unselected.length === 0) {
                filtersText = "Toutes"; 
        } else if (unselected.length <= 2) {
            filtersText = "Toutes sauf " + unselected.join(', ');
        } else {
            filtersText = activeFilters.sort((a,b)=>parseInt(a)-parseInt(b)).join(', ');
        }
        valGen.textContent = filtersText;
        valGen.style.textTransform = "none"; 
        hintGen.classList.add('visible'); 
    }

    document.querySelectorAll('.keyboard-button').forEach(btn => {
        btn.classList.remove('correct', 'present', 'absent');
    });

    targetWord = targetPokemon.normalized;
    wordLength = targetWord.length;
    
    knownLetters = new Array(wordLength).fill(null);
    knownLetters[0] = targetWord[0]; 
    for (let i = 0; i < wordLength; i++) {
        if (targetWord[i] === '-') knownLetters[i] = '-';
        if (targetWord[i] === '.') knownLetters[i] = '.';
    }

    // Initialisation ou reprise
    currentRow = 0;
    currentGuess = targetWord[0];

    if (isResuming) {
        // Chargement des données de sauvegarde
        savedGrid = gameData.grid || [];
        savedGuesses = gameData.guesses || [];
        currentRow = gameData.currentRow || 0;
        
        // Sécurité : si currentRow = 0 mais qu'on a des grilles, on avance
        if (currentRow === 0 && savedGrid.length > 0) {
            currentRow = savedGrid.length;
        }
        
        // RESTAURATION DU MOT EN COURS (celui qu'on tapait avant de quitter)
        if (gameData.currentGuess && gameData.currentGuess.length > 0) {
            currentGuess = gameData.currentGuess;
        } else {
            currentGuess = targetWord[0]; // Par défaut première lettre
        }
    }

    board.innerHTML = "";
    board.style.setProperty('--cols', wordLength);
    for (let i = 0; i < maxGuesses * wordLength; i++) {
        const tile = document.createElement('div');
        tile.classList.add('tile');
        tile.id = 'tile-' + i;
        board.appendChild(tile);
    }

    // --- RESTAURATION ---
    if (isResuming) { 
        restoreGameSession(); 
    } 

    updateGrid(); // Affiche le mot en cours (currentGuess)
    updateHints();
}

// --- FONCTION DE RESTAURATION AMÉLIORÉE ---
function restoreGameSession() {
    let globalKeyUpdates = {};
    
    // On boucle sur les lignes déjà validées (stockées dans savedGuesses/savedGrid)
    // On utilise savedGrid.length comme référence car c'est la vérité terrain des essais validés
    const linesToRestore = savedGrid.length;

    for (let r = 0; r < linesToRestore; r++) {
        const resultString = savedGrid[r];
        const guessWord = savedGuesses[r] || ""; // Mot sauvegardé ou vide si vieille sauvegarde
        const emojiArray = [...resultString]; // Conversion pour gérer les emojis correctement

        const startIdx = r * wordLength;

        // Remplir les tuiles de cette ligne
        for (let c = 0; c < wordLength; c++) {
            const tile = document.getElementById('tile-' + (startIdx + c));
            
            // 1. Récupération de la lettre
            let char = "";
            if (guessWord && guessWord[c]) {
                char = guessWord[c];
            } else {
                // FALLBACK : Si pas de mot sauvegardé (vieux format), on triche intelligemment
                // Si la case est VERTE (rouge dans le code), on met la lettre de la réponse
                if (emojiArray[c] === '🟥' && targetWord[c]) {
                    char = targetWord[c];
                }
            }
            
            tile.textContent = char;
            tile.classList.add('flip'); 
            
            // 2. Application des couleurs
            let stateClass = 'absent';
            let keyboardState = 'absent';
            const stateChar = emojiArray[c];
            
            switch (stateChar) {
                case '🟥': // Correct
                    stateClass = 'correct'; 
                    keyboardState = 'correct';
                    if (char) knownLetters[c] = char; 
                    break;
                case '🟨': // Présent
                    stateClass = 'present'; 
                    keyboardState = 'present';
                    break;
                case '⬛': // Absent
                default: 
                    stateClass = 'absent'; 
                    keyboardState = 'absent';
            }
            tile.classList.add(stateClass);
            
            // 3. Mise à jour clavier
            if (char) {
                const charUpper = char.toUpperCase();
                // Logique de priorité des couleurs clavier (Vert > Jaune > Gris)
                if (globalKeyUpdates[charUpper] === 'correct') {
                    // Reste vert
                } else if (keyboardState === 'correct') {
                    globalKeyUpdates[charUpper] = 'correct';
                } else if (globalKeyUpdates[charUpper] === 'present' && keyboardState === 'absent') {
                    // Reste jaune
                } else if (keyboardState === 'present') {
                    globalKeyUpdates[charUpper] = 'present';
                } else if (!globalKeyUpdates[charUpper]) {
                    globalKeyUpdates[charUpper] = 'absent';
                }
            }
        }
    }
    
    updateKeyboardColors(globalKeyUpdates);
}

// --- KEYBOARD ---

function initKeyboard() {
    keyboardCont.innerHTML = '';
    for (let i = 0; i < 2; i++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'keyboard-row';
        for (let char of keyboardLayout[i]) {
            rowDiv.appendChild(createKeyBtn(char));
        }
        keyboardCont.appendChild(rowDiv);
    }
    const row3 = document.createElement('div');
    row3.className = 'keyboard-row';
    
    const backBtn = document.createElement('button');
    backBtn.textContent = "⌫";
    backBtn.className = "keyboard-button wide btn-back"; 
    backBtn.onclick = deleteLetter;
    row3.appendChild(backBtn);

    for (let char of keyboardLayout[2]) {
        row3.appendChild(createKeyBtn(char));
    }
    
    const dashBtn = createKeyBtn('-');
    dashBtn.style.maxWidth = "40px";
    row3.appendChild(dashBtn);

    const dotBtn = createKeyBtn('.');
    dotBtn.style.maxWidth = "40px";
    row3.appendChild(dotBtn);

    const enterBtn = document.createElement('button');
    enterBtn.textContent = "ENTRÉE";
    enterBtn.className = "keyboard-button wide btn-enter"; 
    enterBtn.onclick = checkGuess;
    row3.appendChild(enterBtn);

    keyboardCont.appendChild(row3);
}

function createKeyBtn(char) {
    const btn = document.createElement('button');
    btn.textContent = char;
    btn.className = 'keyboard-button';
    btn.setAttribute('data-key', char);
    btn.onclick = () => addLetter(char);
    return btn;
}

document.addEventListener('keydown', (e) => {
    if (isGameOver && e.key === 'Enter') {
        restartCurrentMode();
        return;
    }

    if (isGameOver || isProcessing || pokemonList.length === 0) return;
    const key = e.key;
    if (key === 'Enter') checkGuess();
    else if (key === 'Backspace') deleteLetter();
    else if (/^[a-zA-Z\-\.]$/.test(key)) addLetter(key.toUpperCase());
});

function addLetter(letter) {
    if (isGameOver || isProcessing) return;
    
    if (currentGuess.length < wordLength) {
        currentGuess += letter;
        updateGrid();
    }
}

function deleteLetter() {
    if (isGameOver || isProcessing) return;
    
    if (currentGuess.length > fixedLength) {
        currentGuess = currentGuess.slice(0, -1);
        updateGrid();
    }
}

function updateGrid() {
    const startIdx = currentRow * wordLength;
    for (let i = 0; i < wordLength; i++) {
        const tile = document.getElementById('tile-' + (startIdx + i));
        let char = "";
        let className = "tile";

        if (i < currentGuess.length) {
            char = currentGuess[i];
            if (knownLetters[i] && char === knownLetters[i]) {
                className += " correct";
            }
        } 
        else {
            if (knownLetters[i]) {
                char = knownLetters[i];
                className += " correct"; 
            }
        }
        
        tile.textContent = char;
        tile.className = className; 

        if (i === currentGuess.length && !isGameOver) {
            tile.classList.add('active');
        }
    }
}

function updateHints() {
    if (currentRow >= 2) {
        valStage.textContent = targetPokemon.stage;
        hintStage.classList.add('visible');
    }

    if (currentRow >= 3) {
        valType.textContent = targetPokemon.type;
        hintType.classList.add('visible');
    }

    if (gameMode === 'daily') {
        if (currentRow >= 4) {
            if (valGen.textContent !== targetPokemon.gen) {
                valGen.textContent = targetPokemon.gen;
                valGen.style.textTransform = ""; 
                valGen.classList.add('revealed'); 
            }
            hintGen.classList.add('visible');
        }
    }
    else if (gameMode === 'classic') {
        if (currentRow >= 4) {
            if (valGen.textContent !== targetPokemon.gen) {
                valGen.textContent = targetPokemon.gen;
                valGen.style.textTransform = ""; 
                valGen.classList.add('revealed'); 
            }
        }
    }
}

function checkGuess() {
    if (isGameOver || isProcessing) return;

    if (currentGuess.length < 2) {
        showMessage("Mot trop court !");
        triggerShake();
        return;
    }
    if (currentGuess[0] !== targetWord[0]) {
        showMessage("Le mot doit commencer par " + targetWord[0]);
        triggerShake();
        return;
    }
    
    const exists = pokemonList.some(p => p.normalized === currentGuess);
    if (!exists) {
        showMessage("Ce Pokémon n'est pas dans le Pokédex !");
        triggerShake();
        return;
    }

    isProcessing = true;

    const rowTiles = [];
    const startIdx = currentRow * wordLength;
    
    let targetArray = targetWord.split('');
    const guessArray = currentGuess.split('');
    const foundLetters = {}; 

    for (let i = currentGuess.length; i < wordLength; i++) {
        const tile = document.getElementById('tile-' + (startIdx + i));
        tile.textContent = "";       
        tile.className = "tile";     
    }

    guessArray.forEach((char, i) => {
        if (i >= wordLength) return;
        const tile = document.getElementById('tile-' + (startIdx + i));
        rowTiles.push(tile);
        if (i < targetArray.length && char === targetArray[i]) {
            tile.dataset.state = 'correct';
            targetArray[i] = null;
            foundLetters[char] = 'correct';
            knownLetters[i] = char; 
        }
    });

    let rowResult = ""; 
    
    guessArray.forEach((char, i) => {
        if (i >= wordLength) return;
        const tile = rowTiles[i];
        
        if (tile.dataset.state !== 'correct') {
            const indexInTarget = targetArray.indexOf(char);
            if (indexInTarget > -1) {
                tile.dataset.state = 'present';
                targetArray[indexInTarget] = null;
                if (foundLetters[char] !== 'correct') foundLetters[char] = 'present';
            } else {
                tile.dataset.state = 'absent';
                if (!foundLetters[char]) foundLetters[char] = 'absent';
            }
        }
        
        switch(tile.dataset.state) {
            case 'correct':
                rowResult += '🟥';
                break;
            case 'present':
                rowResult += '🟨';
                break;
            default:
                rowResult += '⬛';
        }
    });

    // --- SAUVEGARDE DE L'ESSAI ---
    if (gameMode === 'daily') {
        // Mise à jour des variables globales
        savedGrid.push(rowResult);
        savedGuesses.push(currentGuess);
        
        // On incrémente currentRow après la sauvegarde locale mais avant la sauvegarde disque
        // pour que saveDailyState prenne le bon index
        // ATTENTION : saveDailyState utilise la variable globale currentRow.
        // Ici, on veut dire que l'essai courant est validé.
        
        // On sauvegarde tout de suite avec currentRow actuel (l'essai vient d'être fait)
        // Mais currentRow ne sera incrémenté visuellement qu'à la fin de l'anim.
        // Pour la sauvegarde, on veut marquer que cet essai est fait.
        
        // On simule l'incrément pour la sauvegarde
        currentRow++; 
        currentGuess = ""; // On vide pour la sauvegarde
        
        saveDailyState(); // Sauvegarde !
        
        currentRow--; // On remet pour finir l'animation proprement
        currentGuess = guessArray.join(''); // On remet pour l'anim
    }

    rowTiles.forEach((tile, i) => {
        setTimeout(() => {
            tile.classList.add('flip');
            tile.classList.add(tile.dataset.state);
        }, i * 200);
    });

    setTimeout(() => {
        updateKeyboardColors(foundLetters);
    }, rowTiles.length * 150);

    setTimeout(() => {
        if (currentGuess === targetWord) {
            let winMsg = targetPokemon.original + " ! Bravo !";
            let isShiny = false; 
            if (currentRow === 0) {
                winMsg = "🔥 ONE SHOT ! (" + targetPokemon.original + ") 🔥";
                isShiny = true;
                triggerEmojiRain('✨');
            }
            showMessage(winMsg);
            endGame(true, isShiny); 
        } else if (currentRow === maxGuesses - 1) {
            showMessage("Perdu... C'était " + targetPokemon.original);
            endGame(false); 
        } else {
            currentRow++;
            currentGuess = targetWord[0];
            
            // Mise à jour de la sauvegarde pour dire "je suis prêt pour la ligne suivante"
            if (gameMode === 'daily') {
                saveDailyState(); 
            }
            
            updateGrid();
            updateHints();
            isProcessing = false;
        }
    }, Math.max(guessArray.length, wordLength) * 200);
}

function updateKeyboardColors(updates) {
    for (const [char, state] of Object.entries(updates)) {
        if (char === '-') continue; 
        const btn = document.querySelector(`.keyboard-button[data-key="${char}"]`);
        if (btn) {
            if (btn.classList.contains('correct')) continue;
            if (btn.classList.contains('present') && state === 'absent') continue;
            btn.classList.remove('present', 'absent'); 
            btn.classList.add(state);
        }
    }
}

function triggerShake() {
    const startIdx = currentRow * wordLength;
    for (let i = 0; i < wordLength; i++) {
        const tile = document.getElementById('tile-' + (startIdx + i));
        tile.classList.add('shake');
        setTimeout(() => tile.classList.remove('shake'), 500);
    }
}

function showMessage(msg) {
    messageEl.textContent = msg;
    if (!isGameOver) {
        setTimeout(() => {
            if (!isGameOver) messageEl.textContent = "";
        }, 3000);
    }
}

function giveUp() {
    if (isGameOver) return;
    showMessage("Dommage ! C'était " + targetPokemon.original);
    endGame(false); 
}

function endGame(isVictory, isShiny = false) {
    isGameOver = true;
    
    keyboardCont.style.display = 'none';
    
    if (targetPokemon && targetPokemon.id) {
        const type = isShiny ? 'shiny' : 'regular';
        resultImg.src = `https://raw.githubusercontent.com/Yarkis01/TyraDex/images/sprites/${targetPokemon.id}/${type}.png`;
        
        resultImg.onerror = function() {
            if (this.src.includes('shiny')) {
                this.src = `https://raw.githubusercontent.com/Yarkis01/TyraDex/images/sprites/${targetPokemon.id}/regular.png`;
                this.onerror = null; 
            }
        };
        
        resultImg.style.display = 'block';
    }

    if (gameMode === 'daily') {
        saveDailyState(); // Sauvegarde finale
        
        restartBtn.style.display = "none"; 
        if (shareBtn) shareBtn.style.display = "inline-block";
        giveupBtn.style.display = "none"; 
        
        let attemptsCount = currentRow + 1;
        saveScoreToFirebase(isVictory, attemptsCount);
    } else {
        restartBtn.style.display = "inline-block"; 
    }
    
    if (gameMode !== 'daily' && shareBtn) shareBtn.style.display = "none";
    giveupBtn.style.display = "none"; 
}

function generateEmojiGrid() {
    const todayKey = getTodayDateKey();
    const storedData = localStorage.getItem('tusmon_daily_' + todayKey);

    if (!storedData) {
        return "J'ai joué à TUSMON mais j'ai pas trouvé le Pokémon...\n\nhttps://tusmon.vercel.app";
    }

    try {
        const result = JSON.parse(storedData);
        let scoreDisplay = result.won 
            ? `${result.attempts} coup${result.attempts > 1 ? 's' : ''}`
            : `X coups`;
        
        let mainMessage;
        if (result.won) {
            if (result.attempts === 1) {
                mainMessage = `TUSMON - J'ai deviné le Pokémon du jour en ONE SHOT ! 🔥✨`; ;
            } else {
                mainMessage = `TUSMON - J'ai deviné le Pokémon du jour en ${scoreDisplay}`;
            }
        } else {
            mainMessage = `TUSMON - J'ai échoué à deviner le Pokémon du jour :(`;
        }

        const emojiGrid = (result.grid && Array.isArray(result.grid)) 
            ? result.grid.join('\n') 
            : '';
            
        const tweetText = `${mainMessage}\n\n${emojiGrid}\n\ntusmon.vercel.app`;
        return tweetText;

    } catch (e) {
        return `J'ai joué à TUSMON aujourd'hui !\n\nhttps://tusmon.vercel.app`;
    }
}

function shareDailyResult() {
    if (gameMode !== 'daily' || isGameOver === false) return; 
    
    const tweetText = generateEmojiGrid();
    const encodedText = encodeURIComponent(tweetText);
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
    
    window.open(twitterUrl, 'ShareOnTwitter', 'width=550,height=700,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no');
}