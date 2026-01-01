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
let gameMode = 'daily'; // 'daily', 'classic', 'streak'
let currentStreak = 0; // Score de chaîne
let knownLetters = []; 
let fixedLength = 0; 
let activeFilters = []; 
let allGenerations = []; 
let lastPlayedId = null; 

// Variables pour la persistance de l'état (Sauvegarde)
let savedGrid = [];     
let savedGuesses = []; 
let gameStartTime = 0; // Heure de début de la session actuelle
let accumulatedTime = 0; // Temps accumulé des sessions précédentes
let timerInterval = null; // Variable pour stocker l'intervalle du chrono visuel

// Variable pour l'Easter Egg
let logoClickCount = 0;

const maxGuesses = 6;
let wordLength = 0;

// Elements DOM
const statusArea = document.getElementById('status-area');
const menuScreen = document.getElementById('menu-screen');
const gameArea = document.getElementById('game-area');
const genFiltersCont = document.getElementById('gen-filters');
const board = document.getElementById('board');
const messageEl = document.getElementById('message');
const resultImg = document.getElementById('pokemon-result-image'); 

const restartBtn = document.getElementById('restart-btn');
const giveupBtn = document.getElementById('giveup-btn');
const validateBtn = document.getElementById('validate-btn'); 
const menuReturnBtn = document.getElementById('menu-return-btn');
const btnDailyStart = document.getElementById('btn-daily-start');

// Bouton spécifique pour le mode série
const nextStreakBtn = document.getElementById('next-streak-btn'); 
// Bouton de démarrage série
const btnStreakStart = document.getElementById('btn-streak-start');

const shareBtn = document.getElementById('share-btn');

const keyboardCont = document.getElementById('keyboard-cont');
const modeBadge = document.getElementById('mode-badge');

// Elements spécifiques au mode Streak
const streakCounter = document.getElementById('streak-counter'); 

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

function saveDailyState() {
    if (gameMode !== 'daily' || !targetPokemon) return;

    const todayKey = getTodayDateKey();
    const lastGuess = savedGuesses.length > 0 ? savedGuesses[savedGuesses.length - 1] : "";
    const hasWon = (lastGuess === targetPokemon.normalized);
    
    const gameState = {
        status: isGameOver ? 'completed' : 'in-progress',
        targetId: targetPokemon.id,
        currentRow: currentRow,
        currentGuess: currentGuess, 
        grid: savedGrid,
        guesses: savedGuesses,
        startTime: gameStartTime, 
        won: isGameOver && hasWon, 
        attempts: currentRow 
    };

    if (isGameOver) {
        gameState.attempts = currentRow + 1; 
    }

    localStorage.setItem('tusmon_daily_' + todayKey, JSON.stringify(gameState));
}

// Fonction pour sauvegarder l'état du mode Série
function saveStreakState() {
    if (gameMode !== 'streak' || !targetPokemon) return;
    
    // Si la partie est finie (perdu), on ne sauvegarde pas l'état "en cours"
    if (isGameOver && document.getElementById('next-streak-btn').style.display === 'none') {
        localStorage.removeItem('tusmon_streak_state');
        return;
    }

    const currentTotalTime = accumulatedTime + (Date.now() - gameStartTime);

    const state = {
        streak: currentStreak,
        targetId: targetPokemon.id,
        currentRow: currentRow,
        currentGuess: currentGuess,
        grid: savedGrid,
        guesses: savedGuesses,
        elapsedTime: currentTotalTime, 
        status: 'in-progress' 
    };
    
    if (isGameOver) {
        state.status = 'round-won';
    }

    localStorage.setItem('tusmon_streak_state', JSON.stringify(state));
}

window.addEventListener('beforeunload', () => {
    if (gameMode === 'daily' && !isGameOver) {
        saveDailyState();
    }
    // Sauvegarde série en quittant
    if (gameMode === 'streak') {
        saveStreakState();
    }
});

// --- UTILS ---

function formatDuration(ms) {
    if (!ms && ms !== 0) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    
    if (m > 0) {
        return `${m}m${s.toString().padStart(2, '0')}s`;
    } else {
        return `${s}s`;
    }
}

// Gestion du Timer Visuel
function startLiveTimer() {
    stopLiveTimer(); // Sécurité
    
    const timerDisplay = document.getElementById('ingame-timer-display');
    if (!timerDisplay) return;

    // Fonction de mise à jour
    const update = () => {
        // Temps total = temps sauvegardé + temps depuis le début de cette session
        const currentTotal = accumulatedTime + (Date.now() - gameStartTime);
        timerDisplay.textContent = formatDuration(currentTotal);
    };

    update(); // Mise à jour immédiate
    timerInterval = setInterval(update, 1000); // Mise à jour chaque seconde
}

function stopLiveTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// --- GESTION FIREBASE (AUTH & LEADERBOARD) ---

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
                     loadWeeklyLeaderboard();
                 }).catch((error) => {
                     console.error("Erreur maj nom:", error);
                     updateAuthUI(result.user);
                     loadLeaderboard();
                     loadWeeklyLeaderboard();
                 });
            } else {
                updateAuthUI(result.user);
                loadLeaderboard();
                loadWeeklyLeaderboard();
            }
        }).catch((error) => {
            console.error(error);
            alert("Erreur de connexion Twitter : " + error.message);
        });
}


function logout() {
    if (!auth) return;
    auth.signOut().then(() => {
        console.log("Déconnecté");
    }).catch((error) => {
        console.error("Erreur de déconnexion :", error);
    });
}

function updateAuthUI(user) {
    currentUser = user;
    const btnLogin = document.getElementById('btn-twitter-login');
    const txtInfo = document.getElementById('user-info');
    const btnLogout = document.getElementById('btn-logout'); 
    const adminSection = document.getElementById('admin-section');

    if (user) {
        const handle = user.displayName || "Joueur";
        btnLogin.style.display = 'none';
        txtInfo.style.display = 'block';
        txtInfo.innerHTML = `Connecté : <strong>${handle}</strong>`;
        
        if (btnLogout) btnLogout.style.display = 'block';

        if (handle === '@suedlemot') {
            if (adminSection) adminSection.style.display = 'flex';
        } else {
            if (adminSection) adminSection.style.display = 'none';
        }

        const todayKey = getTodayDateKey();
        const storedData = localStorage.getItem('tusmon_daily_' + todayKey);
        
        if (storedData) {
            try {
                const result = JSON.parse(storedData);
                if (result && result.status === 'completed') {
                    console.log("Score local trouvé. Synchronisation...");
                    const duration = result.startTime ? (Date.now() - result.startTime) : 0;
                    saveScoreToFirebase(result.won, result.attempts, duration); 
                }
            } catch (e) {}
        }
        checkRemoteDailyStatus();
        loadLeaderboard(); 
        loadWeeklyLeaderboard();
    } else {
        btnLogin.style.display = 'inline-block';
        txtInfo.style.display = 'none';
        if (btnLogout) btnLogout.style.display = 'none';
        
        if (adminSection) adminSection.style.display = 'none';
        
        loadLeaderboard();
        loadWeeklyLeaderboard();
    }
}

function showAdminPanel() {
    document.getElementById('menu-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'flex';
}

function closeAdminPanel() {
    document.getElementById('admin-screen').style.display = 'none';
    document.getElementById('menu-screen').style.display = 'flex';
}

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
                if (!localStorage.getItem('tusmon_daily_' + todayKey)) {
                     localStorage.setItem('tusmon_daily_' + todayKey, JSON.stringify({status: 'completed', remote: true}));
                }
            }
        }
    }).catch(err => console.error("Erreur vérif score distant:", err));
}

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
                
                let timeDisplay = "";
                if (data.won && data.duration) {
                    timeDisplay = formatDuration(data.duration);
                }

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
                            <td style="text-align:right; font-size:0.85rem; color:#888;">${timeDisplay}</td>
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

function saveScoreToFirebase(won, attempts, duration = 0) {
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
                duration: duration,
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
    stopLiveTimer(); // Arrêt du timer en retournant au menu

    // Sauvegardes avant de quitter
    if (gameMode === 'daily' && !isGameOver && targetPokemon) {
        saveDailyState(); 
    }
    if (gameMode === 'streak' && targetPokemon) {
        saveStreakState();
    }

    gameArea.style.display = 'none';
    menuScreen.style.display = 'flex';
    isGameOver = true; 
    logoClickCount = 0; 
    
    if (gameMode === 'daily') {
        loadLeaderboard();
        loadWeeklyLeaderboard();
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

    // Gestion de l'affichage du bouton STREAK (Reprendre ou Démarrer)
    const storedStreak = localStorage.getItem('tusmon_streak_state');
    if (btnStreakStart) {
        if (storedStreak) {
            try {
                const sData = JSON.parse(storedStreak);
                if (sData) {
                    btnStreakStart.textContent = `REPRENDRE ENDURANCE (${sData.streak})`;
                } else {
                    btnStreakStart.textContent = "DÉMARRER L'ENDURANCE";
                }
            } catch(e) {
                btnStreakStart.textContent = "DÉMARRER L'ENDURANCE";
            }
        } else {
            btnStreakStart.textContent = "DÉMARRER L'ENDURANCE";
        }
    }

    if (currentUser) {
        checkRemoteDailyStatus();
    }
    
    if (streakCounter) streakCounter.style.display = 'none';
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
                gameStartTime = gameData.startTime || Date.now();
            }
        } catch (e) {
            console.error("Erreur parsing:", e);
        }
    }

    if (!isResuming) {
        gameStartTime = Date.now();
        
        const initialState = { 
            status: 'in-progress', 
            grid: [],
            guesses: [],
            targetId: targetPokemon.id,
            currentRow: 0,
            currentGuess: "",
            startTime: gameStartTime
        };
        localStorage.setItem('tusmon_daily_' + todayKey, JSON.stringify(initialState));
    }

    setupGameUI(isResuming, gameData);
}

// --- FONCTIONS MODE SÉRIE ---
function startStreakGame() {
    gameMode = 'streak';
    gamePool = [...pokemonList];
    activeFilters = []; 
    
    if (gamePool.length === 0) {
        alert("Erreur: Liste de Pokémon vide");
        return;
    }

    // Vérifier s'il y a une sauvegarde "Série"
    const savedStreak = localStorage.getItem('tusmon_streak_state');
    if (savedStreak) {
        try {
            const data = JSON.parse(savedStreak);
            if (data && (data.status === 'in-progress' || data.status === 'round-won')) {
                console.log("Reprise de la série...");
                
                currentStreak = data.streak || 0;
                targetPokemon = pokemonList.find(p => p.id === data.targetId);
                accumulatedTime = data.elapsedTime || 0;
                gameStartTime = Date.now();

                if (!targetPokemon) {
                    pickRandomPokemon();
                    setupGameUI(false);
                    return;
                }

                if (data.status === 'round-won') {
                    setupGameUI(true, data);
                    showMessage("Bravo ! Endurance : " + currentStreak + " 🔥");
                    isGameOver = true;
                    stopLiveTimer(); // On arrête le chrono si c'est gagné
                    
                    document.getElementById('keyboard-cont').style.display = 'none';
                    if (validateBtn) validateBtn.style.display = 'none';
                    if (giveupBtn) giveupBtn.style.display = 'none';
                    if (nextStreakBtn) nextStreakBtn.style.display = 'inline-block';
                    
                    if (targetPokemon && targetPokemon.id) {
                         const type = 'regular';
                         resultImg.src = `https://raw.githubusercontent.com/Yarkis01/TyraDex/images/sprites/${targetPokemon.id}/${type}.png`;
                         resultImg.style.display = 'block';
                    }
                    console.log("%c🔥 SOLUTION ENDURANCE (Reprise): " + targetPokemon.original, "color: #f0b230; font-weight: bold; font-size: 1.2em;");
                    
                } else {
                    console.log("%c🔥 SOLUTION ENDURANCE (Reprise): " + targetPokemon.original, "color: #f0b230; font-weight: bold; font-size: 1.2em;");
                    setupGameUI(true, data);
                }
                return;
            }
        } catch (e) {
            console.error("Erreur parsing streak save", e);
        }
    }

    // Nouvelle partie
    currentStreak = 0; 
    savedGrid = [];
    savedGuesses = [];
    currentRow = 0;
    currentGuess = "";
    
    accumulatedTime = 0;
    gameStartTime = Date.now();
    
    pickRandomPokemon();
    setupGameUI(false);
}

// Fonction appelée quand on gagne et qu'on clique sur "Suivant"
function nextStreakLevel() {
    if (gameMode !== 'streak') return;
    
    accumulatedTime += (Date.now() - gameStartTime);
    gameStartTime = Date.now(); 

    savedGrid = [];
    savedGuesses = [];
    currentRow = 0;
    currentGuess = "";
    isGameOver = false;

    pickRandomPokemon();
    setupGameUI(false);
    
    saveStreakState();
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

    savedGrid = [];
    savedGuesses = [];
    currentRow = 0;
    currentGuess = "";

    pickRandomPokemon();
    setupGameUI(false);
}

function pickRandomPokemon() {
    if (gamePool.length <= 1) {
        targetPokemon = gamePool[0];
    } else {
        let randomIndex;
        let newPokemon;
        let safety = 0;
        do {
            randomIndex = Math.floor(Math.random() * gamePool.length);
            newPokemon = gamePool[randomIndex];
            safety++;
        } while (newPokemon.id === lastPlayedId && safety < 10);
        
        targetPokemon = newPokemon;
        lastPlayedId = targetPokemon.id;
    }

    if (gameMode === 'streak') {
        console.log("%c🔥 SOLUTION ENDURANCE : " + targetPokemon.original, "color: #f0b230; font-weight: bold; font-size: 1.2em;");
    } else {
        console.log("Solution (Mode Aléatoire) : " + targetPokemon.original);
    }
}

function getDailyPokemonIndex(listLength) {
    const dateStr = getTodayDateKey();
    
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
        hash |= 0; 
    }

    let z = (hash + 0x9E3779B9) | 0;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    z = z ^ (z >>> 16);

    return (z >>> 0) % listLength;
}

function restartCurrentMode() {
    if (gameMode === 'classic') {
        startRandomGame();
    } else if (gameMode === 'streak') {
        localStorage.removeItem('tusmon_streak_state');
        startStreakGame(); 
    } else {
        showMenu();
    }
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

    // Gestion des boutons de fin
    restartBtn.style.display = "none";
    giveupBtn.style.display = "inline-block";
    menuReturnBtn.style.display = "inline-block";
    validateBtn.style.display = "inline-block";
    
    // Le bouton next est caché par défaut
    if (nextStreakBtn) nextStreakBtn.style.display = "none";
    
    // Reset des indices
    valGen.classList.remove('revealed');
    hintStage.classList.remove('visible');
    hintType.classList.remove('visible');
    
    // GESTION DES BADGES ET AFFICHAGES
    if (streakCounter) streakCounter.style.display = 'none';

    // 1. GESTION DU BADGE ET AFFICHAGE SCORE
    
    // Elément Score
    let inGameScoreDisplay = document.getElementById('ingame-score-display');
    if (!inGameScoreDisplay) {
        inGameScoreDisplay = document.createElement('div');
        inGameScoreDisplay.id = 'ingame-score-display';
        // Style simple : jaune doré, gras, un peu d'espace
        inGameScoreDisplay.style.color = '#f0b230';
        inGameScoreDisplay.style.fontWeight = 'bold';
        inGameScoreDisplay.style.fontSize = '1.1rem';
        inGameScoreDisplay.style.marginTop = '5px';
        inGameScoreDisplay.style.textTransform = 'uppercase';
        // On l'ajoute au DOM mais la position sera réglée plus bas
        modeBadge.parentNode.insertBefore(inGameScoreDisplay, modeBadge.nextSibling);
    }

    // Elément Timer (NOUVEAU)
    let inGameTimerDisplay = document.getElementById('ingame-timer-display');
    if (!inGameTimerDisplay) {
        inGameTimerDisplay = document.createElement('div');
        inGameTimerDisplay.id = 'ingame-timer-display';
        // STYLE DU TIMER : Identique au Score
        inGameTimerDisplay.style.color = '#ffffff';
        inGameTimerDisplay.style.fontWeight = 'bold';
        inGameTimerDisplay.style.fontSize = '1.1rem';
        inGameTimerDisplay.style.textTransform = 'uppercase';
        inGameTimerDisplay.style.marginTop = '5px'; // Même espacement
        
        // Insertion
        modeBadge.parentNode.insertBefore(inGameTimerDisplay, modeBadge.nextSibling);
    }

    // Reset affichage
    inGameScoreDisplay.style.display = 'none';
    inGameTimerDisplay.style.display = 'none';
    stopLiveTimer();

    // 2. CONFIG SELON MODE
    if (gameMode === 'daily') {
        modeBadge.textContent = "POKÉMON DU JOUR";
        modeBadge.classList.remove('classic');
        modeBadge.style.background = ""; 
        modeBadge.style.backgroundColor = "var(--correct)";
        
        lblGen.textContent = "GÉN:";
        valGen.textContent = ""; 
        valGen.style.textTransform = ""; 
        hintGen.classList.remove('visible'); 

    } else if (gameMode === 'streak') {
        modeBadge.textContent = "MODE ENDURANCE 🔥";
        modeBadge.classList.add('classic');
        modeBadge.style.background = "linear-gradient(45deg, #833ab4, #fd1d1d, #fcb045)";
        modeBadge.style.border = "none";

        // Affichage Score
        inGameScoreDisplay.style.display = 'block';
        inGameScoreDisplay.textContent = "Endurance : " + currentStreak;

        // Affichage Timer et démarrage
        inGameTimerDisplay.style.display = 'block';
        startLiveTimer();

        // Réorganisation visuelle : Badge -> Timer -> Score
        // On déplace le timer APRES le badge
        modeBadge.parentNode.insertBefore(inGameTimerDisplay, modeBadge.nextSibling);
        // On déplace le score APRES le timer
        modeBadge.parentNode.insertBefore(inGameScoreDisplay, inGameTimerDisplay.nextSibling);

        if (streakCounter) {
            streakCounter.style.display = 'block';
            streakCounter.textContent = "Endurance actuelle : " + currentStreak;
        }

        lblGen.textContent = "GÉN:";
        valGen.textContent = ""; 
        valGen.style.textTransform = ""; 
        hintGen.classList.remove('visible'); 

    } else {
        // Classic Random
        modeBadge.textContent = "MODE ALÉATOIRE";
        modeBadge.classList.add('classic');
        modeBadge.style.background = ""; 
        modeBadge.style.backgroundColor = "var(--btn-neutral)";

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

    // Reset visuel du clavier
    document.querySelectorAll('.keyboard-button').forEach(btn => {
        btn.classList.remove('correct', 'present', 'absent');
    });

    targetWord = targetPokemon.normalized;
    wordLength = targetWord.length;
    
    fixedLength = 1; 

    knownLetters = new Array(wordLength).fill(null);
    knownLetters[0] = targetWord[0]; 
    for (let i = 0; i < wordLength; i++) {
        if (targetWord[i] === '-') knownLetters[i] = '-';
        if (targetWord[i] === '.') knownLetters[i] = '.';
    }

    // Si on ne reprend pas une partie, on s'assure que tout est à zéro
    if (!isResuming) {
        currentRow = 0;
        currentGuess = targetWord[0];
    } else {
        savedGrid = gameData.grid || [];
        savedGuesses = gameData.guesses || [];
        currentRow = gameData.currentRow || 0;
        
        // CORRECTION BUG DOUBLE LIGNE : 
        // Si le statut est "round-won", on ne doit pas avancer à la ligne suivante.
        // On reste sur la dernière ligne jouée (la ligne gagnante).
        if (gameData.status === 'round-won') {
             currentRow = savedGrid.length > 0 ? savedGrid.length - 1 : 0;
             // On remet le mot gagnant dans currentGuess pour l'affichage correct
             currentGuess = savedGuesses[currentRow] || targetWord;
             // Si on reprend un round gagné, on arrête le timer visuel (il est figé)
             stopLiveTimer();
             if(inGameTimerDisplay) inGameTimerDisplay.textContent = formatDuration(accumulatedTime);
        } else {
            // Comportement standard pour une partie en cours
            if (currentRow === 0 && savedGrid.length > 0) {
                currentRow = savedGrid.length;
            }
            
            if (gameData.currentGuess && gameData.currentGuess.length > 0) {
                currentGuess = gameData.currentGuess;
            } else {
                currentGuess = targetWord[0]; 
            }
        }
    }

    // CONSTRUCTION DE LA GRILLE (C'est ici que ça se joue !)
    board.innerHTML = "";
    board.style.setProperty('--cols', wordLength);
    for (let i = 0; i < maxGuesses * wordLength; i++) {
        const tile = document.createElement('div');
        tile.classList.add('tile');
        tile.id = 'tile-' + i;
        board.appendChild(tile);
    }

    if (isResuming) { 
        restoreGameSession(); 
    } 

    updateGrid(); 
    updateHints();
}

function restoreGameSession() {
    let globalKeyUpdates = {};
    const linesToRestore = savedGrid.length;

    for (let r = 0; r < linesToRestore; r++) {
        const resultString = savedGrid[r];
        const guessWord = savedGuesses[r] || ""; 
        const emojiArray = [...resultString]; 

        const startIdx = r * wordLength;

        for (let c = 0; c < wordLength; c++) {
            const tile = document.getElementById('tile-' + (startIdx + c));
            
            let char = "";
            if (guessWord && guessWord[c]) {
                char = guessWord[c];
            } else {
                if (emojiArray[c] === '🟥' && targetWord[c]) {
                    char = targetWord[c];
                }
            }
            
            tile.textContent = char;
            tile.classList.add('flip'); 
            
            let stateClass = 'absent';
            let keyboardState = 'absent';
            const stateChar = emojiArray[c];
            
            switch (stateChar) {
                case '🟥': 
                    stateClass = 'correct'; 
                    keyboardState = 'correct';
                    if (char) knownLetters[c] = char; 
                    break;
                case '🟨': 
                    stateClass = 'present'; 
                    keyboardState = 'present';
                    break;
                case '⬛': 
                default: 
                    stateClass = 'absent'; 
                    keyboardState = 'absent';
            }
            tile.classList.add(stateClass);
            
            if (char) {
                const charUpper = char.toUpperCase();
                if (globalKeyUpdates[charUpper] === 'correct') {
                } else if (keyboardState === 'correct') {
                    globalKeyUpdates[charUpper] = 'correct';
                } else if (globalKeyUpdates[charUpper] === 'present' && keyboardState === 'absent') {
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
        // En mode streak, Entrée valide le "Niveau Suivant" ou "Rejouer"
        if (gameMode === 'streak') {
            if (nextStreakBtn && nextStreakBtn.style.display !== 'none') {
                nextStreakLevel();
            } else if (restartBtn && restartBtn.style.display !== 'none') {
                startStreakGame();
            }
        } else {
             restartCurrentMode();
        }
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

    // MODIFICATION : Le mode Streak est ajouté ici pour être géré comme le Daily
    if (gameMode === 'daily' || gameMode === 'streak') {
        if (currentRow >= 4) {
            if (valGen.textContent !== targetPokemon.gen) {
                valGen.textContent = targetPokemon.gen;
                valGen.style.textTransform = ""; 
                valGen.classList.add('revealed'); 
            }
            hintGen.classList.add('visible');
        }
    }
    // En random (classic), on révèle la Gen au 4eme essai aussi (si elle était pas visible ?)
    // Note : en random "valGen" contient déjà les filtres, donc le révéler le change juste en la vraie valeur
    else {
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

    // SAUVEGARDE QUOTIDIENNE
    if (gameMode === 'daily') {
        savedGrid.push(rowResult);
        savedGuesses.push(currentGuess);
        currentRow++; 
        currentGuess = ""; 
        saveDailyState(); 
        currentRow--; 
        currentGuess = guessArray.join(''); 
    }
    // SAUVEGARDE SÉRIE (Ajouté ici pour sauvegarder à chaque coup)
    else if (gameMode === 'streak') {
        savedGrid.push(rowResult);
        savedGuesses.push(currentGuess);
        // On sauvegarde l'état avant de savoir si c'est fini ou non
        currentRow++; 
        currentGuess = "";
        saveStreakState();
        currentRow--; 
        currentGuess = guessArray.join(''); 
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
            // VICTOIRE
            let winMsg = targetPokemon.original + " ! Bravo !";
            let isShiny = false; 
            if (currentRow === 0) {
                winMsg = "🔥 ONE SHOT ! (" + targetPokemon.original + ") 🔥";
                isShiny = true;
                triggerEmojiRain('✨');
            }
            
            if (gameMode === 'streak') {
                currentStreak++;
                // Mise à jour visuelle du compteur menu (si existant)
                if (streakCounter) streakCounter.textContent = "Série actuelle : " + currentStreak;
                
                // Mise à jour visuelle du score en jeu
                const inGameScoreDisplay = document.getElementById('ingame-score-display');
                if (inGameScoreDisplay) inGameScoreDisplay.textContent = "Endurance : " + currentStreak;

                winMsg = "Bravo ! Endurance : " + currentStreak + " 🔥";
                
                // Sauvegarde après victoire du round (pour pouvoir reprendre)
                // Note : saveStreakState sera appelé dans endGame -> saveStreakState (si non game over)
                // Mais ici on n'a pas encore mis isGameOver à true, donc on le fait manuellement après
            }

            showMessage(winMsg);
            endGame(true, isShiny); 

        } else if (currentRow === maxGuesses - 1) {
            // DÉFAITE
            showMessage("Perdu... C'était " + targetPokemon.original);
            endGame(false); 
        } else {
            // TOUR SUIVANT
            currentRow++;
            currentGuess = targetWord[0];
            
            if (gameMode === 'daily') {
                saveDailyState(); 
            } else if (gameMode === 'streak') {
                saveStreakState();
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
    // Si game over en streak, on laisse le message affiché pour voir le score
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
    
    // Arrêt du timer visuel car la partie est finie
    stopLiveTimer();
    
    keyboardCont.style.display = 'none';
    if (validateBtn) validateBtn.style.display = 'none';
    
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
        saveDailyState(); 
        restartBtn.style.display = "none"; 
        if (shareBtn) shareBtn.style.display = "inline-block";
        
        let duration = 0;
        if (isVictory && gameStartTime > 0) {
            duration = Date.now() - gameStartTime;
        }
        
        saveScoreToFirebase(isVictory, currentRow + 1, duration);
    } 
    else if (gameMode === 'streak') {
        if (isVictory) {
            // Victoire en streak : on propose le suivant
            restartBtn.style.display = "none"; 
            if (nextStreakBtn) nextStreakBtn.style.display = "inline-block";
            // On sauvegarde l'état "gagné mais pas fini" pour pouvoir reprendre
            saveStreakState();
            
            // AJOUT : Sauvegarde du record hebdo même si on continue
            checkAndSaveWeeklyStreak(currentStreak, accumulatedTime); // Note: accumulatedTime a été mis à jour dans nextStreakLevel mais ici on sauvegarde le temps jusqu'à la victoire

        } else {
            // Défaite en streak : on affiche le score final et le bouton Rejouer
            messageEl.textContent += ` (Endurance finie : ${currentStreak})`;
            restartBtn.style.display = "inline-block"; 
            restartBtn.textContent = "Recommencer l'endurance"; // Petit bonus UX
            if (nextStreakBtn) nextStreakBtn.style.display = "none";
            
            // AJOUT : Sauvegarde finale du record
            const finalTime = accumulatedTime + (Date.now() - gameStartTime);
            checkAndSaveWeeklyStreak(currentStreak, finalTime);
            
            // Suppression de la sauvegarde car perdu
            localStorage.removeItem('tusmon_streak_state');
        }
    }
    else {
        // Classic Random
        restartBtn.style.display = "inline-block"; 
        restartBtn.textContent = "Rejouer";
    }
    
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

// --- LOGIQUE CLASSEMENT HEBDOMADAIRE ---

// 1. Calculer la clé de la semaine (Ex: "2023-10-23" pour le lundi de la semaine)
function getCurrentWeekKey() {
    const d = new Date();
    const day = d.getDay(); // 0 (Dimanche) à 6 (Samedi)
    // On veut que la semaine commence le Lundi.
    // Si on est dimanche (0), on recule de 6 jours. Sinon on recule de (jour - 1).
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
    
    const monday = new Date(d.setDate(diff));
    // Format YYYY-MM-DD
    return monday.toISOString().split('T')[0];
}

// 2. Charger le classement hebdo
function loadWeeklyLeaderboard() {
    if (!db) return;

    const weeklyContainer = document.getElementById('weekly-leaderboard-container');
    const weeklyDateLabel = document.getElementById('weekly-date');
    const weekKey = getCurrentWeekKey();

    // Afficher la date de la semaine
    if (weeklyDateLabel) {
        const d = new Date(weekKey);
        const options = { day: 'numeric', month: 'short' };
        weeklyDateLabel.textContent = "Semaine du " + d.toLocaleDateString('fr-FR', options);
    }

    db.collection('weekly_streaks').doc(weekKey).collection('players')
        .orderBy('streak', 'desc') // On trie par plus grosse série
        .orderBy('timestamp', 'asc') // En cas d'égalité, le premier l'emporte
        .limit(5)
        .get()
        .then((querySnapshot) => {
            if (querySnapshot.empty) {
                weeklyContainer.innerHTML = '<p style="text-align:center; color:#888; font-style:italic; font-size:0.8rem;">Aucune endurance cette semaine.</p>';
                return;
            }

            let html = '<table>';
            let rank = 1;
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                // Couleur : Or pour la série
                const color = '#f0b230'; 
                const styles = (currentUser && currentUser.uid === doc.id) ? 'font-weight:bold; color:#fff;' : 'color:#ccc;';
                
                let timeDisplay = "";
                if (data.duration) {
                    timeDisplay = formatDuration(data.duration);
                }

                const imgHtml = data.photoURL 
                    ? `<img src="${data.photoURL}" class="profile-pic" alt="pic">` 
                    : `<div class="profile-pic" style="background:#444; display:inline-block; width:24px; height:24px; border-radius:50%;"></div>`;
                
                // Petite flamme pour le premier
                let iconHtml = rank === 1 ? '<span class="crown-emoji">🔥</span>' : '';
                
                let userLink = data.handle || 'Anonyme';
                if (data.handle && data.handle.startsWith('@')) {
                    userLink = data.handle; // On garde simple pour l'affichage
                }

                html += `<tr style="${styles}">
                            <td style="width:20px;">#${rank}</td>
                            <td><div class="user-cell"><div class="profile-pic-wrapper">${imgHtml}${iconHtml}</div><span>${userLink}</span></div></td>
                            <td style="text-align:right; font-size:0.85rem; color:#888;">${timeDisplay}</td>
                            <td style="text-align:right; color:${color}; font-weight:bold;">${data.streak}</td>
                         </tr>`;
                rank++;
            });
            html += '</table>';
            weeklyContainer.innerHTML = html;
        })
        .catch((error) => {
            console.error("Erreur classement hebdo:", error);
            weeklyContainer.innerHTML = '<p style="text-align:center; color:#d9534f;">Erreur...</p>';
        });
}

// 3. Sauvegarder le score Hebdo (Uniquement si c'est le meilleur score de la semaine)
function checkAndSaveWeeklyStreak(streakScore, duration = 0) {
    if (!currentUser || !db) return;
    
    // On ne sauvegarde pas les scores de 0
    if (streakScore <= 0) return;

    const weekKey = getCurrentWeekKey();
    const userRef = db.collection('weekly_streaks').doc(weekKey).collection('players').doc(currentUser.uid);

    // On utilise une transaction pour lire puis écrire de manière sûre
    db.runTransaction((transaction) => {
        return transaction.get(userRef).then((doc) => {
            if (!doc.exists) {
                // Pas encore de score cette semaine, on crée
                transaction.set(userRef, {
                    handle: currentUser.displayName || "Joueur",
                    photoURL: currentUser.photoURL || null,
                    streak: streakScore,
                    duration: duration,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                const data = doc.data();
                const currentBest = data.streak || 0;
                // Si le nouveau score est meilleur, on met à jour
                if (streakScore > currentBest) {
                    transaction.update(userRef, {
                        streak: streakScore,
                        duration: duration, 
                        handle: currentUser.displayName || "Joueur", // Mise à jour du pseudo au cas où
                        photoURL: currentUser.photoURL || null,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
        });
    }).then(() => {
        console.log("Score hebdo vérifié/mis à jour.");
        loadWeeklyLeaderboard(); // Rafraîchir l'affichage
    }).catch((err) => {
        console.error("Erreur sauvegarde hebdo:", err);
    });
}