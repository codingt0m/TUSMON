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
// Le bouton skipBtn a été retiré du HTML, on retire donc sa référence ici pour éviter les erreurs
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

// --- GESTION FIREBASE (AUTH & LEADERBOARD) ---

// 1. Connexion Twitter
function loginWithTwitter() {
    if (!auth) return;
    const provider = new firebase.auth.TwitterAuthProvider();
    auth.signInWithPopup(provider)
        .then((result) => {
            // Tentative de récupération du handle (username sans @)
            const twitterHandle = result.additionalUserInfo?.username;
            
            // Si on a le handle, on met à jour le profil (pour l'avoir dans currentUser.displayName)
            // Sinon Firebase utilise le nom complet par défaut
            if(twitterHandle) {
                 result.user.updateProfile({ displayName: '@' + twitterHandle }).then(() => {
                     updateAuthUI(result.user);
                 });
            } else {
                updateAuthUI(result.user);
            }
            loadLeaderboard(); 
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

    if (user) {
        const handle = user.displayName || "Joueur";
        btnLogin.style.display = 'none';
        txtInfo.style.display = 'block';
        txtInfo.innerHTML = `Connecté : <strong>${handle}</strong>`;
        
        // MODIFICATION : Vérification du score local en attente de synchronisation
        const todayKey = getTodayDateKey();
        const storedData = localStorage.getItem('tusmon_daily_' + todayKey);
        
        if (storedData) {
            try {
                // On vérifie si c'est le nouveau format JSON
                // (Si l'utilisateur a joué avant de se connecter)
                const result = JSON.parse(storedData);
                if (result && result.status === 'completed') {
                    console.log("Score local trouvé. Synchronisation...");
                    saveScoreToFirebase(result.won, result.attempts);
                }
            } catch (e) {
                // Ignore les anciens formats non-JSON
            }
        }

        // NOUVEAU : On vérifie immédiatement sur le serveur si le joueur a déjà joué aujourd'hui
        // (Empêche de rejouer en changeant de navigateur)
        checkRemoteDailyStatus();

    } else {
        btnLogin.style.display = 'inline-block';
        txtInfo.style.display = 'none';
    }
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
                btnDaily.textContent = "DÉJÀ JOUÉ"; // Modification ici : texte simplifié
                // Sécurité supplémentaire : on met à jour le local storage pour éviter le délai au prochain refresh
                // On utilise un marqueur simple si pas de données locales
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

    // --- AJOUT : Date sous le titre ---
    const leaderboardSection = document.getElementById('leaderboard-section');
    if (leaderboardSection) {
        const titleEl = leaderboardSection.querySelector('.menu-title');
        if (titleEl) {
            // 1. On s'assure que le titre est bien "Classement du Jour"
            titleEl.textContent = "Classement du Jour 🏆";

            // 2. Calcul de la date
            const now = new Date();
            const options = { weekday: 'long', day: 'numeric', month: 'long' };
            let dateStr = now.toLocaleDateString('fr-FR', options);
            
            // Capitalisation (Lundi 1 Janvier)
            dateStr = dateStr.split(' ')
                             .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                             .join(' ');

            // 3. Gestion de l'élément sous-titre pour la date
            let dateEl = document.getElementById('leaderboard-date-subtitle');
            
            // Si l'élément n'existe pas encore, on le crée
            if (!dateEl) {
                dateEl = document.createElement('div');
                dateEl.id = 'leaderboard-date-subtitle';
                
                // Styles : non gras, centré, couleur légèrement atténuée
                dateEl.style.fontWeight = 'normal';
                dateEl.style.fontSize = '0.95rem';
                dateEl.style.color = '#ddd'; 
                dateEl.style.textAlign = 'center';
                dateEl.style.marginTop = '-5px'; // Un peu plus proche du titre
                dateEl.style.marginBottom = '10px';

                // Insertion juste après le titre dans le DOM
                titleEl.parentNode.insertBefore(dateEl, titleEl.nextSibling);
            }

            // Mise à jour du texte
            dateEl.textContent = dateStr;
        }
    }
    // -----------------------------------------------------------

    const dateKey = getTodayDateKey();
    const leaderboardDiv = document.getElementById('leaderboard-container');
    
    // LOGIQUE DE TRI :
    // 1. Les gagnants ('won' desc)
    // 2. Le moins d'essais ('attempts' asc)
    // 3. Le plus rapide en cas d'égalité ('timestamp' asc)
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
                
                // MODIFICATION : Affichage personnalisé du score
                let scoreDisplay;
                if (data.won) {
                    // Gestion du pluriel pour "essai"
                    scoreDisplay = `${data.attempts} essai${data.attempts > 1 ? 's' : ''}`;
                } else {
                    scoreDisplay = "Perdu";
                }

                const color = data.won ? '#538d4e' : '#d9534f';
                const styles = (currentUser && currentUser.uid === doc.id) ? 'font-weight:bold; color:#fff;' : 'color:#ccc;';
                
                // GESTION PHOTO DE PROFIL
                const imgHtml = data.photoURL 
                    ? `<img src="${data.photoURL}" class="profile-pic" alt="pic">` 
                    : `<div class="profile-pic" style="background:#444; display:inline-block; width:24px; height:24px; border-radius:50%;"></div>`;
                
                // AJOUT COURONNE POUR LE RANG 1
                let crownHtml = '';
                if (rank === 1) {
                    crownHtml = '<span class="crown-emoji">👑</span>';
                }

                // GESTION DU LIEN TWITTER
                let userLink = data.handle || 'Anonyme';
                if (data.handle && data.handle.startsWith('@')) {
                    // On enlève le @ pour créer l'URL
                    const twitterUser = data.handle.substring(1);
                    userLink = `<a href="https://twitter.com/${twitterUser}" target="_blank" style="color: inherit; text-decoration: none; hover:text-decoration: underline;">${data.handle}</a>`;
                } else if (data.handle) {
                     // Cas où le handle n'a pas de @ (rare si bien géré, mais sécurité)
                     userLink = `<a href="https://twitter.com/${data.handle}" target="_blank" style="color: inherit; text-decoration: none;">${data.handle}</a>`;
                }

                html += `<tr style="${styles}">
                            <td style="width:20px;">#${rank}</td>
                            <td>
                                <div class="user-cell">
                                    <div class="profile-pic-wrapper">
                                        ${imgHtml}
                                        ${crownHtml}
                                    </div>
                                    <span>${userLink}</span>
                                </div>
                            </td>
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

// 4. Sauvegarder le score (MODIFIÉ POUR ANTI-DOUBLON ET PHOTO)
function saveScoreToFirebase(won, attempts) {
    if (!currentUser || !db) return; // Suppression de la vérif gameMode pour permettre la sync hors-jeu

    const dateKey = getTodayDateKey();
    const userHandle = currentUser.displayName || "Joueur";
    // Récupération de l'URL de la photo (si dispo)
    const userPhoto = currentUser.photoURL || null;
    
    const userScoreRef = db.collection('daily_scores').doc(dateKey).collection('players').doc(currentUser.uid);

    // VÉRIFICATION : Le document existe-t-il déjà ?
    userScoreRef.get().then((docSnapshot) => {
        if (docSnapshot.exists) {
            console.log("Score déjà existant en base. Pas d'écrasement.");
            // On peut recharger le leaderboard au cas où
            loadLeaderboard();
            // On s'assure que le bouton est bien bloqué
            checkRemoteDailyStatus();
        } else {
            // Pas de score, on enregistre
            userScoreRef.set({
                handle: userHandle,
                photoURL: userPhoto, // AJOUT DE LA PHOTO
                attempts: attempts,
                won: won,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            })
            .then(() => {
                console.log("Score envoyé avec succès !");
                loadLeaderboard(); 
                checkRemoteDailyStatus(); // Bloquer le bouton après envoi
            })
            .catch((error) => console.error("Erreur envoi score:", error));
        }
    }).catch((error) => {
        console.error("Erreur lors de la vérification du score:", error);
    });
}


// --- INIT ---
window.addEventListener('DOMContentLoaded', () => {
    initKeyboard();

    // Écouteur Auth Firebase
    if (auth) {
        auth.onAuthStateChanged((user) => {
            updateAuthUI(user);
            loadLeaderboard(); 
        });
    }

    // Écouteur Bouton Twitter
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
                // On récupère l'ID en colonne 0
                let id = parts[0] ? parts[0].trim() : "0"; 

                if (normalized.length >= 3) {
                    pokemonList.push({ 
                        id: id, // Stockage de l'ID
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

// --- FONCTION "TOUT COCHER" ---
function selectAllGens() {
    const checkboxes = genFiltersCont.querySelectorAll('input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    // Si tout est coché, on décoche tout. Sinon on coche tout.
    checkboxes.forEach(cb => cb.checked = !allChecked);
}

// --- GESTION DU LOGO ET EASTER EGG ---
function handleLogoClick() {
    // Si on est sur le menu, on compte les clics pour l'Easter Egg
    if (menuScreen.style.display !== 'none') {
        logoClickCount++;
        if (logoClickCount > 3) {
            triggerPokeballRain();
            logoClickCount = 0; // Reset
        }
    } else {
        // Si on est en jeu, on retourne au menu
        showMenu();
    }
}

function showMenu() {
    gameArea.style.display = 'none';
    menuScreen.style.display = 'flex';
    isGameOver = true; 
    logoClickCount = 0; // Reset compteur au retour menu
    
    // Au retour au menu, on recharge le leaderboard pour être sûr qu'il est à jour
    if (gameMode === 'daily') {
        loadLeaderboard();
    }

    const todayKey = getTodayDateKey();
    const hasPlayedDaily = localStorage.getItem('tusmon_daily_' + todayKey);
    
    // 1. Check local (rapide)
    if (hasPlayedDaily) {
        btnDailyStart.disabled = true;
        btnDailyStart.textContent = "DÉJÀ JOUÉ AUJOURD'HUI";
    } else {
        btnDailyStart.disabled = false;
        btnDailyStart.textContent = "JOUER AU POKÉMON DU JOUR";
    }

    // 2. Check distant (sécurité si connecté)
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

// --- ANIMATION PLUIE (FLAMMES / ETOILES / POKEBALLS) ---
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
            // Spawn from origin element (center X + variance)
            const randomX = (Math.random() - 0.5) * rect.width; 
            element.style.left = (rect.left + rect.width / 2 + randomX) + 'px';
            element.style.top = (rect.top + rect.height / 2) + 'px';
            
            // Add horizontal drift
            const randomDrift = (Math.random() - 0.5) * 300; // +/- 150px drift
            element.style.setProperty('--fall-x', randomDrift + 'px');
        } else {
            // Full screen rain
            element.style.left = Math.random() * 100 + 'vw';
            element.style.top = '-50px';
            element.style.setProperty('--fall-x', '0px'); // Fall straight or minimal drift
        }

        element.style.animationDuration = (Math.random() * 2 + 2) + 's';
        element.style.opacity = Math.random();
        
        document.body.appendChild(element);

        setTimeout(() => {
            element.remove();
        }, 5000);
    }
}

function triggerEmojiRain(emojiChar) {
    triggerFallingItems(emojiChar, false, null); // Full screen
}

function triggerPokeballRain() {
    const logo = document.querySelector('h1');
    // Environ 17 pokéballs (50 / 3)
    triggerFallingItems('https://upload.wikimedia.org/wikipedia/commons/5/51/Pokebola-pokeball-png-0.png', true, logo, 17);
}

// --- GESTION POPUP IMAGE ---
function showGenPopup() {
    const content = valGen.textContent;
    
    if (/^\d+$/.test(content)) {
        const genNum = content;
        genImg.src = `./ressources/img/${genNum}.jpg`;
        
        const rect = hintGen.getBoundingClientRect();
        
        let leftPos = rect.left + (rect.width / 2) - 225; // 225 = moitié de max-width 450
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
    
    // NOUVEAU : Réinitialiser la grille locale pour la nouvelle partie
    const todayKey = getTodayDateKey();
    localStorage.setItem('tusmon_daily_' + todayKey, JSON.stringify({ status: 'in-progress', grid: [] }));

    setupGameUI();
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
    // Sécurité : si le pool est très petit (1 seul pokemon), on ne peut pas éviter la répétition sans bloquer
    if (gamePool.length <= 1) {
        targetPokemon = gamePool[0];
        return;
    }

    let randomIndex;
    let newPokemon;

    // On boucle tant qu'on tombe sur le même ID que la dernière fois
    do {
        randomIndex = Math.floor(Math.random() * gamePool.length);
        newPokemon = gamePool[randomIndex];
    } while (newPokemon.id === lastPlayedId);
    
    targetPokemon = newPokemon;
    lastPlayedId = targetPokemon.id; // Mémorisation pour la prochaine fois
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

// La fonction skipToClassic n'est plus appelée, mais on peut la laisser ou l'enlever. 
// Le bouton est supprimé, donc elle n'est plus accessible.
function skipToClassic() {
    const checkboxes = genFiltersCont.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    startRandomGame();
}

function setupGameUI() {
    menuScreen.style.display = 'none';
    gameArea.style.display = 'flex';
    
    // Assurer que le clavier est visible au début
    keyboardCont.style.display = 'flex';

    currentRow = 0;
    isGameOver = false;
    isProcessing = false;
    messageEl.textContent = "";
    resultImg.style.display = "none"; // Cacher l'image de fin
    resultImg.src = "";
    
    // Masquer le bouton de partage au début de la partie
    if (shareBtn) shareBtn.style.display = "none";

    restartBtn.style.display = "none";
    giveupBtn.style.display = "inline-block";
    menuReturnBtn.style.display = "inline-block";
    
    // SUPPRESSION DE LA LIGNE QUI CAUSAIT L'ERREUR :
    // skipBtn.style.display = ...  <- CETTE LIGNE EST RETIRÉE

    // Reset CSS class
    valGen.classList.remove('revealed');

    // Reset hint visibility
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
    console.log("Solution :", targetWord); 

    knownLetters = new Array(wordLength).fill(null);
    knownLetters[0] = targetWord[0]; 
    for (let i = 0; i < wordLength; i++) {
        if (targetWord[i] === '-') knownLetters[i] = '-';
        if (targetWord[i] === '.') knownLetters[i] = '.';
    }

    currentGuess = targetWord[0];
    fixedLength = 1; 

    board.innerHTML = "";
    board.style.setProperty('--cols', wordLength);
    for (let i = 0; i < maxGuesses * wordLength; i++) {
        const tile = document.createElement('div');
        tile.classList.add('tile');
        tile.id = 'tile-' + i;
        board.appendChild(tile);
    }

    updateGrid();
    updateHints();
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
    backBtn.className = "keyboard-button wide btn-back"; // Ajout de la classe CSS
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
    enterBtn.className = "keyboard-button wide btn-enter"; // Ajout de la classe CSS
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
        // On permet TOUT (même écraser les tirets)
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
            // Affichage de l'indice en fond (si pas encore tapé)
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

    let rowResult = ""; // Variable pour stocker la ligne d'emojis
    
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
        
        // LOGIQUE POUR CRÉER LA LIGNE D'EMOJIS
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

    // Enregistrement de la ligne d'emojis dans le localStorage si mode daily
    if (gameMode === 'daily') {
        const todayKey = getTodayDateKey();
        const storedData = localStorage.getItem('tusmon_daily_' + todayKey);
        // Récupérer les données existantes ou initialiser
        let gameResult = storedData ? JSON.parse(storedData) : { status: 'in-progress', grid: [] };
        
        // S'assurer que grid est un tableau et l'initialiser
        if (!Array.isArray(gameResult.grid)) gameResult.grid = [];
        
        gameResult.grid[currentRow] = rowResult; // Sauvegarde la ligne actuelle
        localStorage.setItem('tusmon_daily_' + todayKey, JSON.stringify(gameResult));
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
            let isShiny = false; // Flag pour shiny
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
            // Pas de remplissage automatique
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
    
    // Masquer le clavier
    keyboardCont.style.display = 'none';
    
    // Affiche l'image du Pokémon (Shiny si One Shot, sinon Regular)
    if (targetPokemon && targetPokemon.id) {
        const type = isShiny ? 'shiny' : 'regular';
        resultImg.src = `https://raw.githubusercontent.com/Yarkis01/TyraDex/images/sprites/${targetPokemon.id}/${type}.png`;
        
        // Ajout du gestionnaire d'erreur (fallback)
        resultImg.onerror = function() {
            if (this.src.includes('shiny')) {
                this.src = `https://raw.githubusercontent.com/Yarkis01/TyraDex/images/sprites/${targetPokemon.id}/regular.png`;
                this.onerror = null; // Évite une boucle infinie si regular échoue aussi
            }
        };
        
        resultImg.style.display = 'block';
    }

    if (gameMode === 'daily') {
        const todayKey = getTodayDateKey();
        
        // 1. On récupère la grille complète du localStorage
        const storedData = localStorage.getItem('tusmon_daily_' + todayKey);
        // On récupère les données existantes, ou un objet vide si non trouvé
        let gameResult = storedData ? JSON.parse(storedData) : { status: 'in-progress', grid: [] };
        
        // 2. MODIFICATION : Ajout des infos finales au stockage local
        gameResult.status = 'completed';
        gameResult.won = isVictory;
        gameResult.attempts = currentRow + 1;
        
        // L'ID du Pokémon du jour (pour le tweet)
        const dailyIndex = getDailyPokemonIndex(pokemonList.length);
        gameResult.dailyId = pokemonList[dailyIndex].id; // Stocke l'ID du Pokémon
        
        // Si le joueur a abandonné/perdu sans remplir toutes les lignes, on ajoute les lignes noires nécessaires
        if (!isVictory && gameResult.grid.length < maxGuesses) {
            const emptyLine = '⬛'.repeat(wordLength);
            while (gameResult.grid.length < maxGuesses) {
                gameResult.grid.push(emptyLine);
            }
        }
        
        localStorage.setItem('tusmon_daily_' + todayKey, JSON.stringify(gameResult));
        
        restartBtn.style.display = "none"; 

        // 3. Afficher le bouton de partage et Masquer les boutons classiques
        if (shareBtn) shareBtn.style.display = "inline-block";
        giveupBtn.style.display = "none"; 
        
        // --- ENVOI SCORE FIREBASE ---
        let attemptsCount = currentRow + 1;
        saveScoreToFirebase(isVictory, attemptsCount);
        // ----------------------------
        
    } else {
        restartBtn.style.display = "inline-block"; 
    }
    
    // Assure que les boutons de contrôle restants sont gérés
    if (gameMode !== 'daily' && shareBtn) shareBtn.style.display = "none";
    giveupBtn.style.display = "none"; 
}


// --- NOUVELLE FONCTION : Génération de la grille d'emojis ---
function generateEmojiGrid() {
    const todayKey = getTodayDateKey();
    const storedData = localStorage.getItem('tusmon_daily_' + todayKey);

    if (!storedData) {
        // Changement du lien vers celui demandé par l'utilisateur
        return "J'ai joué à TUSMON mais j'ai pas trouvé le Pokémon...\n\nhttps://tusmon.vercel.app";
    }

    try {
        const result = JSON.parse(storedData);
        
        // Score affiché: le nombre de tentatives si gagné, ou 'X' si perdu
        let scoreDisplay = result.won 
            ? `${result.attempts} coup${result.attempts > 1 ? 's' : ''}` // Ajout 'coup(s)'
            : `X coups`;
        
        // Message principal
        let mainMessage;
        if (result.won) {
            if (result.attempts === 1) {
                // Cas spécifique pour le ONE SHOT
                mainMessage = `TUSMON - J'ai deviné le Pokémon du jour en ONE SHOT !`;
            } else {
                // Cas pour les autres victoires
                mainMessage = `TUSMON - J'ai deviné le Pokémon du jour en ${scoreDisplay}`;
            }
        } else {
            // Cas de la défaite
            mainMessage = `TUSMON - J'ai échoué à deviner le Pokémon du jour !`;
        }

        // La grille d'emojis est contenue dans result.grid (une liste de chaînes)
        const emojiGrid = (result.grid && Array.isArray(result.grid)) 
            ? result.grid.join('\n') 
            : '';
            
        // Le texte du tweet au nouveau format
        const tweetText = `${mainMessage}\n\n${emojiGrid}\n\ntusmon.vercel.app`;

        return tweetText;

    } catch (e) {
        console.error("Erreur de parsing du localStorage pour le partage:", e);
        return `J'ai joué à TUSMON aujourd'hui !\n\nhttps://tusmon.vercel.app`;
    }
}


// --- NOUVELLE FONCTION : Partage Twitter ---
function shareDailyResult() {
    // Ne fonctionne que si le bouton de partage est visible (donc, en mode daily terminé)
    if (gameMode !== 'daily' || isGameOver === false) return; 
    
    const tweetText = generateEmojiGrid();
    
    // Encodage pour l'URL
    const encodedText = encodeURIComponent(tweetText);
    
    // Construction de l'URL de partage Twitter (utiliser "url" pour le lien du jeu)
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
    
    // Ouverture de la fenêtre popup
    // Remplacé 'twitter.com' par le lien officiel de l'intent pour plus de sécurité
    window.open(twitterUrl, 'ShareOnTwitter', 'width=550,height=700,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no');
}