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

let isAdmin = false; // Variable globale pour le statut admin

// --- VARIABLES DU JEU ---
let pokemonList = []; 
let gamePool = [];    
let targetPokemon = null; 
let targetWord = "";
let currentGuess = "";
let currentRow = 0;
let isGameOver = false;
let isProcessing = false;
let gameMode = 'daily'; // 'daily', 'classic', 'streak', 'test'
let currentStreak = 0; // Score de chaîne
let currentStreakAttempts = 0; // Cumul des essais pour la moyenne
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

    // --- MODIFICATION : Règle d'abandon ---
    // Si le joueur est à 0 de streak et n'a pas encore validé de mot (row 0),
    // le retour au menu correspond à un abandon (on ne sauvegarde pas).
    if (currentStreak === 0 && currentRow === 0) {
        localStorage.removeItem('tusmon_streak_state');
        return;
    }

    const currentTotalTime = accumulatedTime + (Date.now() - gameStartTime);

    const state = {
        streak: currentStreak,
        streakAttempts: currentStreakAttempts, // SAUVEGARDE CUMUL
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

    // MISE À JOUR DU STATUT ADMIN
    isAdmin = user && user.displayName === '@suedlemot';

    if (user) {
        const handle = user.displayName || "Joueur";
        btnLogin.style.display = 'none';
        txtInfo.style.display = 'block';
        txtInfo.innerHTML = `Connecté : <strong>${handle}</strong>`;
        
        if (btnLogout) btnLogout.style.display = 'block';

        // Utilisation de isAdmin pour l'affichage du menu
        if (adminSection) {
            adminSection.style.display = isAdmin ? 'flex' : 'none';
        }

        const todayKey = getTodayDateKey();
        const storedData = localStorage.getItem('tusmon_daily_' + todayKey);
        
        if (storedData) {
            try {
                const result = JSON.parse(storedData);
                if (result && result.status === 'completed') {
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

// --- FONCTION ADMIN : SUPPRIMER UN SCORE ---
function deleteScore(type, userId) {
    if (!db || !isAdmin) return; // Utilise isAdmin
    
    if (!confirm("⚠️ Supprimer ce score définitivement ?")) return;

    let docRef; 
    if (type === 'daily') {
        docRef = db.collection('daily_scores').doc(getTodayDateKey()).collection('players').doc(userId);
    } else if (type === 'weekly') {
        docRef = db.collection('weekly_streaks').doc(getCurrentWeekKey()).collection('players').doc(userId);
    } else return;

    docRef.delete().then(() => {
        loadLeaderboard();
        loadWeeklyLeaderboard();
    }).catch(err => console.error("Erreur suppression:", err));
}

// --- CLASSEMENT DU JOUR (Modifié : En-tête "Essais" + Chiffre seul) ---
// --- CLASSEMENT DU JOUR ---
function loadLeaderboard() {
    if (!db) return;

    // Gestion du titre et de la date
    const leaderboardSection = document.getElementById('leaderboard-section');
    if (leaderboardSection) {
        const titleEl = leaderboardSection.querySelector('.menu-title');
        if (titleEl) {
            titleEl.textContent = "Classement du Jour 🏆";
            
            // Formatage de la date : Mardi 6 Janvier
            const now = new Date();
            const options = { weekday: 'long', day: 'numeric', month: 'long' };
            let dateStr = now.toLocaleDateString('fr-FR', options);
            
            // Capitalisation de chaque mot
            dateStr = dateStr.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

            // Cible l'élément de date existant dans le HTML (qui a déjà le style gris/italique)
            let dateEl = document.getElementById('leaderboard-date');
            if (dateEl) {
                dateEl.textContent = dateStr;
            }
        }
    }

    const dateKey = getTodayDateKey();
    const leaderboardDiv = document.getElementById('leaderboard-container');
    // On récupère le statut admin depuis la variable globale currentUser
    const isAdmin = currentUser && currentUser.displayName === '@suedlemot';

    db.collection('daily_scores').doc(dateKey).collection('players')
        .orderBy('won', 'desc') 
        .orderBy('attempts', 'asc') 
        .orderBy('timestamp', 'asc') 
        .limit(20)
        .get()
        .then((querySnapshot) => {
            if (querySnapshot.empty) {
                leaderboardDiv.innerHTML = '<p style="text-align:center; color:#888;">Soyez le premier à gagner !</p>';
                return;
            }

            let html = '<table><thead><tr>';
            html += '<th style="width:30px">#</th>';
            html += '<th>Joueur</th>';
            html += '<th style="text-align:right">Essais</th>';
            html += '<th style="text-align:right">Temps</th>';
            if(isAdmin) html += '<th></th>';
            html += '</tr></thead><tbody>';

            let rank = 1;
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                
                let scoreDisplay = data.won ? data.attempts : "Perdu";
                const color = data.won ? '#538d4e' : '#d9534f';
                
                const styles = (currentUser && currentUser.uid === doc.id) 
                    ? 'font-weight:bold; color:#fff; background-color: rgba(255,255,255,0.05);' 
                    : 'color:#ccc;';
                
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
                    userLink = `<a href="https://twitter.com/${twitterUser}" target="_blank" style="color: inherit; text-decoration: none;">${data.handle}</a>`;
                }

                let deleteBtn = "";
                if (isAdmin) {
                    deleteBtn = `<td style="width:20px; text-align:right;">
                        <button class="btn-delete-score" onclick="deleteScore('daily', '${doc.id}')" title="Supprimer">✕</button>
                    </td>`;
                }

                html += `<tr style="${styles}">
                            <td>${rank}</td>
                            <td><div class="user-cell"><div class="profile-pic-wrapper">${imgHtml}${crownHtml}</div><span>${userLink}</span></div></td>
                            <td style="text-align:right; color:${color}">${scoreDisplay}</td>
                            <td style="text-align:right; font-size:0.85rem; color:#888;">${timeDisplay}</td>
                            ${deleteBtn}
                         </tr>`;
                rank++;
            });
            html += '</tbody></table>';
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
    
    // --- NOUVEAU : Vérification de la limite journalière ---
    const streakDoneKey = 'tusmon_streak_done_' + todayKey;
    const hasPlayedStreakToday = localStorage.getItem(streakDoneKey);

    if (btnStreakStart) {
        // Reset par défaut
        btnStreakStart.disabled = false;

        if (storedStreak) {
            try {
                const sData = JSON.parse(storedStreak);
                // Si une partie est sauvegardée et valide (non vide), on propose de REPRENDRE
                // (Même si on a déjà joué aujourd'hui, on a le droit de finir sa partie d'hier)
                if (sData && !(sData.streak === 0 && (!sData.guesses || sData.guesses.length === 0) && (!sData.currentGuess || sData.currentGuess.length <= 1))) {
                    btnStreakStart.textContent = `REPRENDRE ENDURANCE (${sData.streak})`;
                } else {
                    // Sauvegarde invalide ou vide -> On traite comme une nouvelle partie
                    localStorage.removeItem('tusmon_streak_state');
                    
                    if (hasPlayedStreakToday) {
                        btnStreakStart.textContent = "REVENEZ DEMAIN";
                        btnStreakStart.disabled = true;
                    } else {
                        btnStreakStart.textContent = "DÉMARRER L'ENDURANCE";
                    }
                }
            } catch(e) {
                // Erreur de lecture -> On assume nouvelle partie
                if (hasPlayedStreakToday) {
                    btnStreakStart.textContent = "REVENEZ DEMAIN";
                    btnStreakStart.disabled = true;
                } else {
                    btnStreakStart.textContent = "DÉMARRER L'ENDURANCE";
                }
            }
        } else {
            // Pas de sauvegarde -> Vérification de la limite
            if (hasPlayedStreakToday) {
                btnStreakStart.textContent = "REVENEZ DEMAIN";
                btnStreakStart.disabled = true;
            } else {
                btnStreakStart.textContent = "DÉMARRER L'ENDURANCE";
            }
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
    
    // IMPORTANT : Réinitialiser le temps accumulé pour le mode Quotidien
    // car on se base sur l'heure de début originale vs maintenant
    accumulatedTime = 0; 

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
                // RECUPERATION DU CUMUL
                currentStreakAttempts = data.streakAttempts || 0;
                
                // UTILISATION DE == pour comparaison souple (string vs number)
                targetPokemon = pokemonList.find(p => p.id == data.targetId);
                
                accumulatedTime = data.elapsedTime || 0;
                gameStartTime = Date.now();

                if (!targetPokemon) {
                    console.warn("Pokemon id not found:", data.targetId);
                    pickRandomPokemon();
                    setupGameUI(false); 
                    return;
                }

                if (data.status === 'round-won') {
                    setupGameUI(true, data);
                    showMessage("Bravo ! Endurance : " + currentStreak + " 🔥");
                    isGameOver = true;
                    stopLiveTimer(); 
                    
                    document.getElementById('keyboard-cont').style.display = 'none';
                    if (validateBtn) validateBtn.style.display = 'none';
                    if (giveupBtn) giveupBtn.style.display = 'none';
                    if (nextStreakBtn) nextStreakBtn.style.display = 'inline-block';
                    
                    if (targetPokemon && targetPokemon.id) {
                         const type = 'regular'; 
                         resultImg.src = `https://raw.githubusercontent.com/Yarkis01/TyraDex/images/sprites/${targetPokemon.id}/${type}.png`;
                         resultImg.style.display = 'block';
                    }
                } else {
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
    currentStreakAttempts = 0; // RESET
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

// --- FONCTION ADMIN : LANCER UN TEST ---
function startTestGame() {
    const input = document.getElementById('admin-poke-id');
    const idToTest = input.value.trim();
    
    if (!idToTest) {
        alert("Veuillez entrer un ID !");
        return;
    }

    // Recherche du Pokémon par ID (comparaison souple string/number)
    const found = pokemonList.find(p => p.id == idToTest);
    
    if (!found) {
        alert("Pokémon introuvable avec l'ID : " + idToTest);
        return;
    }

    console.log("Lancement du test pour : ", found);

    // Configuration de la partie de test
    gameMode = 'test';
    targetPokemon = found;
    activeFilters = []; // Pas de filtres
    
    // Reset des états
    savedGrid = [];
    savedGuesses = [];
    currentRow = 0;
    currentGuess = "";
    isGameOver = false;
    
    // Fermer l'admin et lancer l'UI
    closeAdminPanel();
    setupGameUI(false);
}


// --- MISE À JOUR DE L'UI (Modifiée pour inclure le LOG ADMIN) ---
function setupGameUI(isResuming = false, gameData = {}) {
    menuScreen.style.display = 'none';
    gameArea.style.display = 'flex';
    keyboardCont.style.display = 'flex';

    if (gameMode !== 'duel') {
   document.getElementById('duel-status-bar').style.display = 'none';
    }
    // --- AJOUT ADMIN : LOG DE LA RÉPONSE ---
    if (isAdmin && targetPokemon) {
        console.log("%c 🎯 RÉPONSE (ADMIN) : " + targetPokemon.original, "color: #ffd700; font-weight: bold; font-size: 16px; background: #333; padding: 5px; border-radius: 4px;");
    }
    // ---------------------------------------

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
    
    if (nextStreakBtn) nextStreakBtn.style.display = "none";
    
    // Reset des indices
    valGen.classList.remove('revealed');
    hintStage.classList.remove('visible');
    hintType.classList.remove('visible');
    
    // GESTION DES BADGES ET AFFICHAGES
    if (streakCounter) streakCounter.style.display = 'none';

    // Nettoyage éléments score/timer s'ils existent
    let inGameScoreDisplay = document.getElementById('ingame-score-display');
    let inGameTimerDisplay = document.getElementById('ingame-timer-display');
    
    if (inGameScoreDisplay) inGameScoreDisplay.style.display = 'none';
    if (inGameTimerDisplay) {
        inGameTimerDisplay.style.display = 'none';
        stopLiveTimer();
    }

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

        // Affichage du timer pour le Daily
        if (inGameTimerDisplay) {
            inGameTimerDisplay.style.display = 'block';
            startLiveTimer();
        }

    } else if (gameMode === 'streak') {
        modeBadge.textContent = "MODE ENDURANCE 🔥";
        modeBadge.classList.add('classic');
        modeBadge.style.background = "linear-gradient(45deg, #833ab4, #fd1d1d, #fcb045)";
        
        // Affichage Score & Timer pour le mode streak
        if (inGameScoreDisplay) {
            inGameScoreDisplay.style.display = 'block';
            inGameScoreDisplay.textContent = "Endurance : " + currentStreak;
        }
        if (inGameTimerDisplay) {
            inGameTimerDisplay.style.display = 'block';
            startLiveTimer();
        }

        lblGen.textContent = "GÉN:";
        valGen.textContent = ""; 
        valGen.style.textTransform = ""; 
        hintGen.classList.remove('visible'); 

    } else if (gameMode === 'test') {
        modeBadge.textContent = `TEST ADMIN (ID: ${targetPokemon.id})`;
        modeBadge.classList.remove('classic');
        modeBadge.style.background = "";
        modeBadge.style.backgroundColor = "#f0b230"; // Couleur jaune admin
        modeBadge.style.color = "#000";

        lblGen.textContent = "GÉN:";
        valGen.textContent = targetPokemon.gen; 
        valGen.style.textTransform = "";
        hintGen.classList.add('visible');
        valGen.classList.add('revealed');

    } else {
        // Classic Random
        modeBadge.textContent = "MODE ALÉATOIRE";
        modeBadge.classList.add('classic');
        modeBadge.style.background = ""; 
        modeBadge.style.backgroundColor = "var(--btn-neutral)";
        modeBadge.style.color = "#fff";

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

    if (!isResuming) {
        currentRow = 0;
        currentGuess = targetWord[0];
    } else {
        savedGrid = gameData.grid || [];
        savedGuesses = gameData.guesses || [];
        currentRow = gameData.currentRow || 0;
        
        if (gameData.status === 'round-won') {
             currentRow = savedGrid.length > 0 ? savedGrid.length - 1 : 0;
             currentGuess = savedGuesses[currentRow] || targetWord;
             stopLiveTimer();
        } else {
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

    // Construction de la grille
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

    if (gameMode === 'daily') {
        savedGrid.push(rowResult);
        savedGuesses.push(currentGuess);
        currentRow++; 
        currentGuess = ""; 
        saveDailyState(); 
        currentRow--; 
        currentGuess = guessArray.join(''); 
    }
    else if (gameMode === 'streak') {
        savedGrid.push(rowResult);
        savedGuesses.push(currentGuess);
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
                // --- MODIFICATION ICI : On ajoute le nombre d'essais au cumul ---
                currentStreakAttempts += (currentRow + 1); 
                
                if (streakCounter) streakCounter.textContent = "Série actuelle : " + currentStreak;
                
                const inGameScoreDisplay = document.getElementById('ingame-score-display');
                if (inGameScoreDisplay) inGameScoreDisplay.textContent = "Endurance : " + currentStreak;

                winMsg = "Bravo ! Endurance : " + currentStreak + " 🔥";
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
            restartBtn.style.display = "none"; 
            if (nextStreakBtn) nextStreakBtn.style.display = "inline-block";
            saveStreakState();
            
            checkAndSaveWeeklyStreak(currentStreak, accumulatedTime, currentStreakAttempts); 

        } else {
            messageEl.textContent += ` (Endurance finie : ${currentStreak})`;
            restartBtn.style.display = "inline-block"; 
            restartBtn.textContent = "Recommencer l'endurance"; 
            // --- MODIFICATION : Désactiver le bouton rejouer immédiatement si on veut bloquer l'enchainement ---
            // Pour l'UX, on peut laisser le bouton mais il renverra au menu qui sera bloqué, 
            // ou bien on le cache direct. Ici je le laisse pour qu'il voit son score, 
            // mais le retour menu bloquera la suite.
            
            if (nextStreakBtn) nextStreakBtn.style.display = "none";
            
            const finalTime = accumulatedTime + (Date.now() - gameStartTime);
            checkAndSaveWeeklyStreak(currentStreak, finalTime, currentStreakAttempts);
            
            // --- NOUVEAU : On enregistre que le joueur a fini son essai du jour ---
            localStorage.setItem('tusmon_streak_done_' + getTodayDateKey(), 'true');

            localStorage.removeItem('tusmon_streak_state');
        }
    }
    else {
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
    const isAdmin = currentUser && currentUser.displayName === '@suedlemot';

    if (weeklyDateLabel) {
        const d = new Date(weekKey);
        const options = { day: 'numeric', month: 'short' };
        weeklyDateLabel.textContent = "Semaine du " + d.toLocaleDateString('fr-FR', options);
    }

    db.collection('weekly_streaks').doc(weekKey).collection('players')
        .orderBy('streak', 'desc') 
        .orderBy('timestamp', 'asc') 
        .limit(20)
        .get()
        .then((querySnapshot) => {
            if (querySnapshot.empty) {
                weeklyContainer.innerHTML = '<p style="text-align:center; color:#888; font-style:italic; font-size:0.8rem;">Aucune endurance cette semaine.</p>';
                return;
            }

            // AJOUT COLONNE MOY.
            let html = '<table><thead><tr>';
            html += '<th style="width:30px">#</th>';
            html += '<th>Joueur</th>';
            html += '<th style="text-align:right">Score</th>';
            html += '<th style="text-align:right" title="Moyenne d\'essais par Pokémon">Essais moy.</th>';
            html += '<th style="text-align:right">Temps</th>';
            if(isAdmin) html += '<th></th>';
            html += '</tr></thead><tbody>';

            let rank = 1;
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                const color = '#f0b230'; 
                const styles = (currentUser && currentUser.uid === doc.id) 
                    ? 'font-weight:bold; color:#fff; background-color: rgba(255,255,255,0.05);' 
                    : 'color:#ccc;';
                
                let timeDisplay = data.duration ? formatDuration(data.duration) : "--";
                
                // CALCUL MOYENNE
                let avgDisplay = "-";
                if (data.totalAttempts && data.streak > 0) {
                    avgDisplay = (data.totalAttempts / data.streak).toFixed(1);
                }

                const imgHtml = data.photoURL 
                    ? `<img src="${data.photoURL}" class="profile-pic" alt="pic">` 
                    : `<div class="profile-pic" style="background:#444; display:inline-block; width:24px; height:24px; border-radius:50%;"></div>`;
                
                let iconHtml = rank === 1 ? '<span class="crown-emoji">🔥</span>' : '';
                let userLink = data.handle || 'Anonyme';
                if (data.handle && data.handle.startsWith('@')) {
                    userLink = data.handle; 
                }

                let deleteBtn = "";
                if (isAdmin) {
                    deleteBtn = `<td style="width:20px; text-align:right;">
                        <button class="btn-delete-score" onclick="deleteScore('weekly', '${doc.id}')" title="Supprimer">✕</button>
                    </td>`;
                }

                html += `<tr style="${styles}">
                            <td>${rank}</td>
                            <td><div class="user-cell"><div class="profile-pic-wrapper">${imgHtml}${iconHtml}</div><span>${userLink}</span></div></td>
                            <td style="text-align:right; color:${color}; font-weight:bold;">${data.streak}</td>
                            <td style="text-align:right; font-size:0.9rem; color:#aaa;">${avgDisplay}</td>
                            <td style="text-align:right; font-size:0.85rem; color:#888;">${timeDisplay}</td>
                            ${deleteBtn}
                         </tr>`;
                rank++;
            });
            html += '</tbody></table>';
            weeklyContainer.innerHTML = html;
        })
        .catch((error) => {
            console.error("Erreur classement hebdo:", error);
            weeklyContainer.innerHTML = '<p style="text-align:center; color:#d9534f;">Erreur...</p>';
        });
}
// 3. Sauvegarder le score Hebdo (Uniquement si c'est le meilleur score de la semaine)
function checkAndSaveWeeklyStreak(streakScore, duration = 0, totalAttempts = 0) {
    if (!currentUser || !db) return;
    
    if (streakScore <= 0) return;

    const weekKey = getCurrentWeekKey();
    const userRef = db.collection('weekly_streaks').doc(weekKey).collection('players').doc(currentUser.uid);

    db.runTransaction((transaction) => {
        return transaction.get(userRef).then((doc) => {
            if (!doc.exists) {
                // Création nouveau score
                transaction.set(userRef, {
                    handle: currentUser.displayName || "Joueur",
                    photoURL: currentUser.photoURL || null,
                    streak: streakScore,
                    duration: duration,
                    totalAttempts: totalAttempts, // C'est ce champ qui manquait !
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                const data = doc.data();
                const currentBest = data.streak || 0;
                
                if (streakScore > currentBest) {
                    // Mise à jour meilleur score
                    transaction.update(userRef, {
                        streak: streakScore,
                        duration: duration, 
                        totalAttempts: totalAttempts, // Mise à jour du champ
                        handle: currentUser.displayName || "Joueur",
                        photoURL: currentUser.photoURL || null,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
        });
    }).then(() => {
        console.log("Score hebdo vérifié/mis à jour.");
        loadWeeklyLeaderboard();
    }).catch((err) => {
        console.error("Erreur sauvegarde hebdo:", err);
    });
}

// --- FONCTION ADMIN : RESET JOUEUR ---
function resetPlayerDaily() {
    // Vérification sécurité
    if (!currentUser || currentUser.displayName !== '@suedlemot') {
        alert("Accès refusé.");
        return;
    }

    const uidInput = document.getElementById('admin-reset-uid');
    const targetUid = uidInput.value.trim();

    if (!targetUid) {
        alert("Veuillez entrer l'UID du joueur à réinitialiser.");
        return;
    }

    if (!confirm("⚠️ ATTENTION : Cela va supprimer le score de ce joueur pour aujourd'hui et lui permettre de rejouer.\n\nConfirmer ?")) {
        return;
    }

    const dateKey = getTodayDateKey();
    
    // Suppression dans la collection daily_scores
    db.collection('daily_scores').doc(dateKey).collection('players').doc(targetUid).delete()
    .then(() => {
        alert("✅ Joueur réinitialisé avec succès !\nIl doit rafraîchir sa page pour rejouer.");
        uidInput.value = ""; // Vider le champ
        
        // Si l'admin se reset lui-même, on nettoie aussi le localStorage pour effet immédiat
        if (targetUid === currentUser.uid) {
            localStorage.removeItem('tusmon_daily_' + dateKey);
            window.location.reload();
        } else {
            loadLeaderboard(); // Mise à jour du classement affiché
        }
    })
    .catch((error) => {
        console.error("Erreur lors du reset : ", error);
        alert("Erreur : " + error.message);
    });
}
// --- LOGIQUE MODE DUEL ---

let duelId = null;
let isHost = false;
let duelPokemonIds = []; // Les 5 ID à deviner
let duelIndex = 0; // À quel index du tableau duelPokemonIds on est (0 à 4)
let duelUnsubscribe = null; // Pour arrêter l'écoute Firebase
let myDuelScore = 0;

// 1. UI Helpers
function showCreateDuelUI() {
    document.getElementById('duel-menu-buttons').style.display = 'none';
    document.getElementById('duel-create-ui').style.display = 'block';
    createDuelSession();
}

function showJoinDuelUI() {
    document.getElementById('duel-menu-buttons').style.display = 'none';
    document.getElementById('duel-join-ui').style.display = 'flex'; // flex pour layout input/btn
}

function cancelDuelSetup() {
    if (duelUnsubscribe) duelUnsubscribe();
    // Si on était host et qu'on annule, on supprime la room (optionnel mais propre)
    if (isHost && duelId) {
        db.collection('active_duels').doc(duelId).delete();
    }
    
    duelId = null;
    document.getElementById('duel-create-ui').style.display = 'none';
    document.getElementById('duel-join-ui').style.display = 'none';
    document.getElementById('duel-menu-buttons').style.display = 'flex';
}

// 2. Création de session (Host)
function createDuelSession() {
    if (!currentUser) { alert("Vous devez être connecté pour créer un duel !"); cancelDuelSetup(); return; }
    
    // Générer un code à 4 chiffres
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    duelId = code;
    isHost = true;
    document.getElementById('duel-code-display').textContent = code;

    // Tirer 5 Pokémon au hasard
    const selection = [];
    for(let i=0; i<5; i++) {
        const rand = Math.floor(Math.random() * pokemonList.length);
        selection.push(pokemonList[rand].id);
    }
    duelPokemonIds = selection;

    // Créer doc Firestore
    db.collection('active_duels').doc(code).set({
        host: currentUser.displayName,
        guest: null,
        pokemonIds: selection,
        hostProgress: 0,
        guestProgress: 0,
        status: 'waiting',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        listenToDuel(code);
    });
}

// 3. Rejoindre session (Guest)
function joinDuel() {
    if (!currentUser) { alert("Connectez-vous pour jouer !"); return; }
    const code = document.getElementById('duel-code-input').value.trim();
    if (code.length !== 4) return;

    db.collection('active_duels').doc(code).get().then((doc) => {
        if (!doc.exists) {
            alert("Session introuvable !");
            return;
        }
        const data = doc.data();
        if (data.status !== 'waiting') {
            alert("Cette partie a déjà commencé ou est pleine.");
            return;
        }

        // Rejoindre
        duelId = code;
        isHost = false;
        duelPokemonIds = data.pokemonIds;
        
        db.collection('active_duels').doc(code).update({
            guest: currentUser.displayName,
            status: 'playing',
            startTime: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            listenToDuel(code);
        });
    });
}

// 4. Écoute temps réel (Le cœur du système)
function listenToDuel(code) {
    duelUnsubscribe = db.collection('active_duels').doc(code).onSnapshot((doc) => {
        if (!doc.exists) return;
        const data = doc.data();

        // Mise à jour UI scores
        const myProg = isHost ? data.hostProgress : data.guestProgress;
        const oppProg = isHost ? data.guestProgress : data.hostProgress;
        const oppName = isHost ? (data.guest || "...") : data.host;

        const duelBar = document.getElementById('duel-status-bar');
        if (duelBar) {
            document.getElementById('duel-my-prog').textContent = `Moi: ${myProg}/5`;
            document.getElementById('duel-opp-prog').textContent = `${oppName}: ${oppProg}/5`;
        }

        // Démarrage du jeu (Host détecte que Guest a rejoint)
        if (isHost && data.status === 'playing' && menuScreen.style.display !== 'none') {
            startDuelGame();
        }
        // Démarrage du jeu (Guest détecte son propre join)
        if (!isHost && data.status === 'playing' && menuScreen.style.display !== 'none') {
            startDuelGame();
        }

        // Détection Fin de partie
        if (data.status === 'finished') {
            endDuel(data);
        }
    });
}

// 5. Lancement de la boucle de jeu Duel
function startDuelGame() {
    gameMode = 'duel';
    duelIndex = 0;
    myDuelScore = 0;
    
    // UI Setup
    document.getElementById('duel-status-bar').style.display = 'flex';
    document.getElementById('next-streak-btn').style.display = 'none'; // On gère le suivant auto ou via bouton spécifique
    
    loadDuelPokemon(0);
}

function loadDuelPokemon(index) {
    if (index >= 5) {
        // Fin de ma série, j'attends l'autre
        showMessage("Série terminée ! En attente du résultat final...");
        isGameOver = true;
        checkDuelEnd();
        return;
    }

    // Charger le Pokémon spécifique par ID
    const targetId = duelPokemonIds[index];
    // On utilise == car l'id du CSV est string, parfois number
    targetPokemon = pokemonList.find(p => p.id == targetId);

    // Reset du board standard
    savedGrid = [];
    savedGuesses = [];
    currentRow = 0;
    currentGuess = "";
    isGameOver = false;
    
    setupGameUI(false); // Réutilise ta fonction existante
    
    // Surcharge visuelle pour le duel
    modeBadge.textContent = `DUEL (Poké ${index + 1}/5)`;
    modeBadge.style.backgroundColor = "#3498db";
}

// 6. Appelé quand on trouve un Pokémon en duel
function onDuelWin() {
    duelIndex++;
    
    // Mise à jour Firestore
    const updateField = isHost ? 'hostProgress' : 'guestProgress';
    db.collection('active_duels').doc(duelId).update({
        [updateField]: duelIndex
    });

    setTimeout(() => {
        if (duelIndex < 5) {
            loadDuelPokemon(duelIndex);
        } else {
            // J'ai fini mes 5
            showMessage("Terminé ! 🏁");
            checkDuelEnd();
        }
    }, 1500); // Petite pause pour voir la victoire
}

// Vérifier si le duel est totalement fini (les deux ont fini ou abandonné ?)
// Note: Dans une version simple, dès qu'un joueur atteint 5, le jeu peut s'arrêter ou on attend l'autre.
// Ici, on va dire que le premier à 5 déclenche la fin "globale" dans Firestore si on veut une course pure.
function checkDuelEnd() {
    if (duelIndex === 5) {
        // Je signale que j'ai fini. 
        // Si on veut que le premier arrivé gagne immédiatement :
        db.collection('active_duels').doc(duelId).update({
            status: 'finished',
            winner: isHost ? 'host' : 'guest' // Celui qui écrit ça en premier a gagné techniquement
        });
    }
}

function endDuel(data) {
    isGameOver = true;
    stopLiveTimer();
    keyboardCont.style.display = 'none';
    
    let msg = "";
    if (data.winner === (isHost ? 'host' : 'guest')) {
        msg = "🏆 VICTOIRE ! Tu as été plus rapide !";
        triggerEmojiRain('🏆');
    } else {
        msg = "💀 DÉFAITE ! L'adversaire a fini avant toi.";
    }
    
    // Écran de fin custom ou alert
    showMessage(msg);
    setTimeout(() => {
        if(confirm(msg + "\nRetour au menu ?")) {
            if (duelUnsubscribe) duelUnsubscribe();
            showMenu();
        }
    }, 1000);
}