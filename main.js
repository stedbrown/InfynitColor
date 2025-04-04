import * as THREE from 'three';
import gsap from 'gsap'; // NEW: Import GSAP

// --- Constants ---
const GRID_SIZE = 7; // 7x7 grid
const CELL_SIZE = 1.0;
const CELL_SPACING = 0.1; // Gap between cells
const TOTAL_CELL_DIM = CELL_SIZE + CELL_SPACING;
const GRID_DIMENSION = GRID_SIZE * CELL_SIZE + (GRID_SIZE - 1) * CELL_SPACING;
const GRID_START_OFFSET = -GRID_DIMENSION / 2 + CELL_SIZE / 2;
const ANIMATION_DURATION = 0.25; // Animation speed in seconds (NEW)
const MAX_MOVES = 30; // NEW: Define max moves
const LEVEL_SCORE_BASE = 1000; // NEW
const LEVEL_SCORE_INCREMENT = 500; // NEW
const LEVEL_COMPLETE_MOVE_BONUS = 5; // NEW

// --- Game Colors ---
const BLOCK_COLORS = [
    0xff0000, // Red
    0x00ff00, // Lime
    0x0000ff, // Blue
    0xffff00, // Yellow
    0xff00ff  // Magenta
];

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

// --- Camera Setup ---
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// Adjust camera position to view the grid
camera.position.z = GRID_DIMENSION * 1.1; // Move camera back based on grid size
camera.position.y = GRID_DIMENSION * 0.2; // Slightly elevated view
camera.lookAt(0, 0, 0); // Look at the center of the grid

// --- Renderer Setup ---
const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 7.5);
scene.add(directionalLight);

// --- Raycasting --- (NEW)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let draggedBlockInfo = null; // { mesh, color, row, col }
let startDragGridPos = null; // { row, col }

// --- Game State ---
let isProcessingMove = false;
const logicalGrid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null));
const blockMeshes = [];
let score = 0;
const scoreElement = document.getElementById('scoreDisplay');
let movesRemaining = MAX_MOVES; // NEW
const movesElement = document.getElementById('movesDisplay'); // NEW
let currentLevel = 1; // NEW
let levelObjective = { type: 'score', target: 0 }; // NEW - target set in init
const levelElement = document.getElementById('levelDisplay'); // NEW
const objectiveElement = document.getElementById('objectiveDisplay'); // NEW

// --- Grid Helper Functions ---
function gridToWorld(row, col) {
    const x = GRID_START_OFFSET + col * TOTAL_CELL_DIM;
    const y = GRID_START_OFFSET + (GRID_SIZE - 1 - row) * TOTAL_CELL_DIM; // Invert row for typical 2D array indexing (0,0 top-left)
    return new THREE.Vector3(x, y, 0);
}

// Convert world position (on the Z=0 plane) to grid coordinates (NEW)
function worldToGrid(worldPos) {
    const col = Math.round((worldPos.x - GRID_START_OFFSET) / TOTAL_CELL_DIM);
    const rowRaw = (worldPos.y - GRID_START_OFFSET) / TOTAL_CELL_DIM;
    // Invert row calculation and round
    const row = GRID_SIZE - 1 - Math.round(rowRaw);

    if (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) {
        return { row, col };
    }
    return null; // Outside grid bounds
}

// --- Grid Visualization (Optional Base Plane) ---
// You might want a more sophisticated visual grid later (lines, etc.)
const gridPlaneGeo = new THREE.PlaneGeometry(GRID_DIMENSION, GRID_DIMENSION);
const gridPlaneMat = new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }); // Make slightly transparent
const gridPlane = new THREE.Mesh(gridPlaneGeo, gridPlaneMat);
gridPlane.position.z = -CELL_SIZE / 2; // Place slightly behind blocks
scene.add(gridPlane);

// --- Block Creation & Management ---
const blockGeo = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
const blockMaterials = {};
BLOCK_COLORS.forEach(color => {
    blockMaterials[color] = new THREE.MeshStandardMaterial({ color: color });
});

function createBlock(row, col, colorHex, initialSetup = false) {
    if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE || logicalGrid[row][col]) {
        // Don't warn during initial random fill or refill
        if (initialSetup || isProcessingMove) return null;
         console.warn(`Cannot create block at (${row}, ${col})`);
         return null;
    }
    const material = blockMaterials[colorHex];
    if (!material) {
        console.error(`Invalid color: ${colorHex}`);
        return null;
    }
    const mesh = new THREE.Mesh(blockGeo, material);

    // For newly created blocks during refill, start them above the grid
    const startPos = gridToWorld(row, col);
    if (!initialSetup) {
        mesh.position.copy(gridToWorld(-1, col)); // Start above the top row
        mesh.position.y += TOTAL_CELL_DIM * 1.5; // Adjust starting Y pos if needed
    } else {
        mesh.position.copy(startPos); // Place directly if initial setup
    }

    mesh.userData = { row, col, color: colorHex };
    logicalGrid[row][col] = { mesh: mesh, color: colorHex };
    scene.add(mesh);
    blockMeshes.push(mesh);

    // Animate into place if not initial setup
    if (!initialSetup) {
        animateMeshTo(mesh, startPos); // Animate to final grid position
    }

    return mesh;
}

function removeBlockData(row, col) {
    const blockInfo = logicalGrid[row][col];
    if (blockInfo) {
        const meshIndex = blockMeshes.indexOf(blockInfo.mesh);
        if (meshIndex > -1) {
            blockMeshes.splice(meshIndex, 1);
        }
        logicalGrid[row][col] = null;
        return blockInfo.mesh; // Return mesh to be animated out
    } else {
        return null;
    }
}

// --- Match Finding --- (Implementation remains the same)
function findMatches() {
    const matches = [];
    const matchedCells = new Set();
    const cellKey = (r, c) => `${r},${c}`;
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE - 2; c++) {
            const block1 = logicalGrid[r][c];
            const block2 = logicalGrid[r][c + 1];
            const block3 = logicalGrid[r][c + 2];
            if (block1 && block2 && block3 && block1.color === block2.color && block1.color === block3.color) {
                let length = 3;
                while (c + length < GRID_SIZE && logicalGrid[r][c + length] && logicalGrid[r][c + length].color === block1.color) length++;
                for (let i = 0; i < length; i++) {
                    if (!matchedCells.has(cellKey(r, c + i))) {
                        matchedCells.add(cellKey(r, c + i));
                        matches.push({ row: r, col: c + i });
                    }
                }
                c += length - 1;
            }
        }
    }
    for (let c = 0; c < GRID_SIZE; c++) {
        for (let r = 0; r < GRID_SIZE - 2; r++) {
            const block1 = logicalGrid[r][c];
            const block2 = logicalGrid[r + 1][c];
            const block3 = logicalGrid[r + 2][c];
            if (block1 && block2 && block3 && block1.color === block2.color && block1.color === block3.color) {
                let length = 3;
                while (r + length < GRID_SIZE && logicalGrid[r + length][c] && logicalGrid[r + length][c].color === block1.color) length++;
                for (let i = 0; i < length; i++) {
                    if (!matchedCells.has(cellKey(r + i, c))) {
                        matchedCells.add(cellKey(r + i, c));
                        matches.push({ row: r + i, col: c });
                    }
                }
                r += length - 1;
            }
        }
    }
    // if (matches.length > 0) console.log(`Found ${matches.length} matched blocks.`);
    return matches;
}

// --- Gravity and Refill Logic (UPDATED for animation) ---

async function applyGravity() {
    const animations = [];
    // Process columns one by one, from bottom up
    for (let c = 0; c < GRID_SIZE; c++) {
        let emptyRow = GRID_SIZE - 1;
        while (emptyRow >= 0 && logicalGrid[emptyRow][c] !== null) {
            emptyRow--;
        }
        if (emptyRow >= 0) {
            let blockRow = emptyRow - 1;
            while (blockRow >= 0) {
                if (logicalGrid[blockRow][c] !== null) {
                    const blockInfo = logicalGrid[blockRow][c];
                    const targetPosition = gridToWorld(emptyRow, c);

                    // Update logical grid *immediately*
                    logicalGrid[emptyRow][c] = blockInfo;
                    logicalGrid[blockRow][c] = null;

                    // Update mesh userData *immediately*
                    blockInfo.mesh.userData.row = emptyRow;
                    blockInfo.mesh.userData.col = c;

                    // Start animation and add promise to list
                    animations.push(animateMeshTo(blockInfo.mesh, targetPosition));

                    emptyRow--; // Move the target empty row up
                }
                blockRow--;
            }
        }
    }
    if (animations.length > 0) {
        console.log(`Applying gravity to ${animations.length} blocks...`);
        await Promise.all(animations); // Wait for all fall animations to complete
        console.log("Gravity animations complete.");
    }
}

async function refillGrid() {
    const animations = [];
    for (let c = 0; c < GRID_SIZE; c++) {
        for (let r = 0; r < GRID_SIZE; r++) {
            if (logicalGrid[r][c] === null) {
                const randomColorIndex = Math.floor(Math.random() * BLOCK_COLORS.length);
                const color = BLOCK_COLORS[randomColorIndex];
                // createBlock now handles the animation into place
                const newBlockMesh = createBlock(r, c, color); // Creates block above and animates down
                // We don't necessarily need to wait for individual refill anims here
                // unless subsequent logic depends on it. For now, let them run.
            }
        }
    }
     // No need to explicitly await refill animations unless needed later
     console.log("Refilling grid...");
}

// --- Helper Functions ---
function updateScoreDisplay() {
    scoreElement.textContent = `Score: ${score}`;
}
function updateMovesDisplay() { // NEW
    movesElement.textContent = `Moves: ${movesRemaining}`;
}

function generateLevelObjective(level) { // NEW
    const targetScore = LEVEL_SCORE_BASE + (level - 1) * LEVEL_SCORE_INCREMENT;
    levelObjective = { type: 'score', target: targetScore };
    console.log(`Generated Level ${level} Objective: Score ${targetScore}`);
}

function updateLevelDisplay() { // NEW
    levelElement.textContent = `Level: ${currentLevel}`;
    objectiveElement.textContent = `Target: ${levelObjective.target}`;
}

function checkObjectiveCompletion() { // NEW
    if (levelObjective.type === 'score') {
        return score >= levelObjective.target;
    }
    // Future: Add other objective types (e.g., clear X blocks)
    return false;
}

function advanceLevel() { // NEW
    currentLevel++;
    movesRemaining += LEVEL_COMPLETE_MOVE_BONUS;
    generateLevelObjective(currentLevel);
    updateLevelDisplay(); // Update level and new objective
    updateMovesDisplay(); // Update moves display with bonus
    console.log(`Advanced to Level ${currentLevel}! +${LEVEL_COMPLETE_MOVE_BONUS} moves.`);
    // Optional: Add visual feedback for level up
}

// --- Animation Helpers (NEW) ---
function animateMeshTo(mesh, targetPosition, duration = ANIMATION_DURATION) {
    return new Promise(resolve => {
        gsap.to(mesh.position, {
            x: targetPosition.x,
            y: targetPosition.y,
            z: targetPosition.z,
            duration: duration,
            ease: "power1.inOut",
            onComplete: resolve // Resolve promise when animation finishes
        });
    });
}

function animateScaleAndRemove(mesh, duration = ANIMATION_DURATION) {
    return new Promise(resolve => {
        gsap.to(mesh.scale, {
            x: 0.1,
            y: 0.1,
            z: 0.1,
            duration: duration,
            ease: "power1.in",
            onComplete: () => {
                scene.remove(mesh);
                // Optional: Dispose geometry/material if sure it's not reused
                // mesh.geometry.dispose();
                // if (mesh.material) mesh.material.dispose();
                resolve();
            }
        });
    });
}

// --- Main processing loop (UPDATED for level check) ---
async function processMatchesAndRefill() {
    let matchesFoundThisCycle = false;
    let totalScoreThisTurn = 0;
    let keepProcessing = true;

    // Lock is assumed active

    while (keepProcessing) {
        const matches = findMatches();
        if (matches.length > 0) {
             matchesFoundThisCycle = true;
             const scoreForThisMatch = matches.length * 10;
             totalScoreThisTurn += scoreForThisMatch;
             const meshesToRemove = [];
             matches.forEach(match => { const mesh = removeBlockData(match.row, match.col); if (mesh) meshesToRemove.push(mesh); });
             const removalAnimations = meshesToRemove.map(mesh => animateScaleAndRemove(mesh));
             await Promise.all(removalAnimations);
             await applyGravity();
             await refillGrid();
             await new Promise(resolve => setTimeout(resolve, ANIMATION_DURATION * 1000 + 50));
        } else {
            keepProcessing = false;
        }
    }

    let justLeveledUp = false;
    if (matchesFoundThisCycle) {
        score += totalScoreThisTurn;
        updateScoreDisplay(); // Update score display first
        console.log(`Turn finished. Total score: ${score}`);

        // --- Level Completion Check --- (NEW)
        if (checkObjectiveCompletion()) {
            advanceLevel();
            justLeveledUp = true;
        }
        // -----------------------------

    } else {
        // This case shouldn't happen if called from a valid swap
        console.log("No matches found in processing loop.");
    }

    // --- Game Over Check & Unlock --- (NEW LOGIC LOCATION)
    if (movesRemaining <= 0) {
        console.log("GAME OVER - No moves left!");
        showGameOverMessage();
        // isProcessingMove remains true
    } else {
        console.log("Board stable. Ready for input.");
        isProcessingMove = false; // Unlock input ONLY if game is not over
    }
}

// --- Swap Blocks Function (UPDATED for new game over check location) ---
async function swapBlocks(r1, c1, r2, c2) {
    if (isProcessingMove || movesRemaining <= 0) return;

    const block1Info = logicalGrid[r1][c1];
    const block2Info = logicalGrid[r2][c2];
    if (!block1Info || !block2Info) return;

    isProcessingMove = true;
    movesRemaining--;
    updateMovesDisplay();
    console.log(`Move consumed. Remaining: ${movesRemaining}`);

    console.log(`Attempting swap animation: (${r1},${c1}) <-> (${r2},${c2})`);
    const pos1 = gridToWorld(r1, c1);
    const pos2 = gridToWorld(r2, c2);

    logicalGrid[r1][c1] = block2Info;
    logicalGrid[r2][c2] = block1Info;
    block1Info.mesh.userData.row = r2; block1Info.mesh.userData.col = c2;
    block2Info.mesh.userData.row = r1; block2Info.mesh.userData.col = c1;

    const anim1 = animateMeshTo(block1Info.mesh, pos2);
    const anim2 = animateMeshTo(block2Info.mesh, pos1);
    await Promise.all([anim1, anim2]);
    console.log("Swap animation complete.");

    const initialMatches = findMatches();

    if (initialMatches.length > 0) {
        console.log("Initial match found after swap!");
        // processMatchesAndRefill will handle level checks, game over checks, and final unlock
        processMatchesAndRefill();
    } else {
        console.log("No matches found. Animating swap back.");
        // Swap back logical grid immediately
        logicalGrid[r1][c1] = block1Info;
        logicalGrid[r2][c2] = block2Info;
        block1Info.mesh.userData.row = r1; block1Info.mesh.userData.col = c1;
        block2Info.mesh.userData.row = r2; block2Info.mesh.userData.col = c2;

        const animBack1 = animateMeshTo(block1Info.mesh, pos1);
        const animBack2 = animateMeshTo(block2Info.mesh, pos2);
        await Promise.all([animBack1, animBack2]);
        console.log("Swap back animation complete.");

        // Check game over ONLY after swap back animation (no level check needed here)
        if (movesRemaining <= 0) {
             console.log("GAME OVER - No moves left!");
             showGameOverMessage();
             // isProcessingMove remains true
        } else {
             isProcessingMove = false; // Unlock input
        }
    }
}

// NEW Game Over Message function
function showGameOverMessage() {
    // Create a simple overlay message
    const gameOverDiv = document.createElement('div');
    gameOverDiv.id = 'gameOverMessage';
    gameOverDiv.innerHTML = `Game Over!<br>Final Score: ${score}<br>(Refresh to play again)`;
    gameOverDiv.style.position = 'absolute';
    gameOverDiv.style.top = '50%';
    gameOverDiv.style.left = '50%';
    gameOverDiv.style.transform = 'translate(-50%, -50%)';
    gameOverDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    gameOverDiv.style.color = 'white';
    gameOverDiv.style.padding = '40px';
    gameOverDiv.style.borderRadius = '10px';
    gameOverDiv.style.textAlign = 'center';
    gameOverDiv.style.fontSize = '32px';
    gameOverDiv.style.zIndex = '100';
    document.body.appendChild(gameOverDiv);
}

// --- Initial Blocks Setup --- (UPDATED for levels)
function initializeGrid() {
    console.log("Initializing grid...");
    const existingGameOver = document.getElementById('gameOverMessage');
    if (existingGameOver) document.body.removeChild(existingGameOver);

    isProcessingMove = true;
    // Clear previous if any (e.g., during retry)
    blockMeshes.forEach(mesh => scene.remove(mesh));
    blockMeshes.length = 0;
    for(let r=0; r<GRID_SIZE; r++) logicalGrid[r].fill(null);

    score = 0;
    movesRemaining = MAX_MOVES; // Reset moves (NEW)
    currentLevel = 1; // Reset level (NEW)

    let needsRetry = false;
    do {
        needsRetry = false;
        // Clear grid before filling attempt
        blockMeshes.forEach(mesh => scene.remove(mesh));
        blockMeshes.length = 0;
        for (let r = 0; r < GRID_SIZE; r++) logicalGrid[r].fill(null);

        // Fill the grid
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                const randomColorIndex = Math.floor(Math.random() * BLOCK_COLORS.length);
                // Use initialSetup=true to place directly without animation
                createBlock(r, c, BLOCK_COLORS[randomColorIndex], true);
            }
        }
        // Check if this random fill created matches
        if (findMatches().length > 0) {
            console.warn("Initial grid generated with matches! Retrying fill...");
            needsRetry = true;
        }
    } while (needsRetry);

    generateLevelObjective(currentLevel); // Generate initial objective (NEW)

    console.log("Grid initialized successfully without initial matches.");
    updateScoreDisplay();
    updateMovesDisplay(); // Initialize moves display (NEW)
    updateLevelDisplay(); // Initialize level display (NEW)
    isProcessingMove = false;
}

// --- Event Listeners --- (Pointer handlers remain largely the same, just call async swapBlocks)
function updatePointer(event) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onPointerDown(event) {
    if (isProcessingMove || movesRemaining <= 0) return; // Check moves here too (NEW)
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(blockMeshes);
    if (intersects.length > 0) {
        const intersectedMesh = intersects[0].object;
        startDragGridPos = { row: intersectedMesh.userData.row, col: intersectedMesh.userData.col };
        draggedBlockInfo = logicalGrid[startDragGridPos.row][startDragGridPos.col];
        if (draggedBlockInfo) {
             console.log("Pointer down on block:", startDragGridPos);
        } else {
             console.warn("Clicked on mesh with no corresponding logical block?", startDragGridPos);
             startDragGridPos = null; // Reset if logical block is missing
        }
    }
}

function onPointerMove(event) {
    if (isProcessingMove || !draggedBlockInfo) return;
    updatePointer(event);
    // Drag visualization still optional
}

function onPointerUp(event) {
    if (isProcessingMove || !draggedBlockInfo) return;

    // console.log("Pointer up");
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const intersectsPlane = raycaster.intersectObject(gridPlane);
    let targetGridPos = null;
    if (intersectsPlane.length > 0) {
        targetGridPos = worldToGrid(intersectsPlane[0].point);
        // console.log("Drop target grid cell:", targetGridPos);
    }

    if (targetGridPos && !(targetGridPos.row === startDragGridPos.row && targetGridPos.col === startDragGridPos.col)) {
        const rowDiff = Math.abs(targetGridPos.row - startDragGridPos.row);
        const colDiff = Math.abs(targetGridPos.col - startDragGridPos.col);
        if ((rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1)) {
            if (logicalGrid[targetGridPos.row][targetGridPos.col]) {
                swapBlocks(startDragGridPos.row, startDragGridPos.col, targetGridPos.row, targetGridPos.col); // Now calls async version
            } else {
                 console.log("Invalid swap: Target cell is empty.");
                 draggedBlockInfo.mesh.position.copy(gridToWorld(startDragGridPos.row, startDragGridPos.col));
            }
        } else {
            console.log("Invalid swap: Target not adjacent.");
            draggedBlockInfo.mesh.position.copy(gridToWorld(startDragGridPos.row, startDragGridPos.col));
        }
    } else {
        // Snap back if invalid drop
        if (draggedBlockInfo) { // Check draggedBlockInfo exists before accessing mesh
             draggedBlockInfo.mesh.position.copy(gridToWorld(startDragGridPos.row, startDragGridPos.col));
        }
        draggedBlockInfo = null;
        startDragGridPos = null;
    }
    // Clear state IF NOT handled by swapBlocks (e.g. invalid drop)
    if (!isProcessingMove) { // Only clear if swap wasn't initiated
         draggedBlockInfo = null;
         startDragGridPos = null;
    }
}

// Add listeners
renderer.domElement.addEventListener('pointerdown', onPointerDown);
renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerup', onPointerUp);

// --- Window Resize Handler ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
});

// --- Animation Loop --- (Now simpler)
function animate() {
    requestAnimationFrame(animate);
    // GSAP handles the animation updates, just need to render
    renderer.render(scene, camera);
}

// --- Start Game ---
initializeGrid();
animate();
console.log("Game started with GSAP animations and scoring."); 