// ****** editor.js ******
// Logic for the p5.js ship editor - ENHANCED with multi-shape, add vertex, color edit
// VERSION WITH relative scaling, grid, zoom, shape dragging, multi-vertex select, fixes
// +++ Added Axis-Constrained Dragging (Shift Key) +++
// +++ Added Straighten Symmetry Function +++
// +++ Added Undo Functionality (v3 - Correct Drag Undo Timing) +++

// --- Global Variables ---
let shipSelector;
let exportButton;
let addShapeButton;
let addVertexButton;
let fillColorPicker;
let strokeColorPicker;
let strokeWeightInput;
let instructionsDiv;
let thargoidWarningSpan;
let zoomInButton;
let zoomOutButton;
let descriptionDiv;
let straightenButton;
let undoButton;

let currentShipKey = null; // Key ("Sidewinder", "CobraMkIII", etc.) or "--- New Blank ---"
let currentShipDef = null; // The original definition object (if loaded)
let shapes = []; // Array of shape objects: { vertexData: [{x,y},...], fillColor: [r,g,b], strokeColor: [r,g,b], strokeW: number }

// --- Undo History ---
let historyStack = [];
const maxHistorySize = 30; // Max number of undo steps

// --- Display & Scaling ---
let canvasWidth = 600;
let canvasHeight = 450;
let baseDisplaySize = 350; // Initial Max drawing size (represents current zoom)
let maxDefinedShipSize = 1; // Will be calculated from definitions
let pixelsPerUnit = 1; // Scale factor: pixels / ship size unit
let gridSpacing = 25; // World units between grid lines (adjust for visual density)

// --- Zoom Control ---
const zoomFactor = 1.2; // How much to zoom per click
const minBaseDisplaySize = 50; // Min zoom out level (in pixels for largest ship)
const maxBaseDisplaySize = 2000; // Max zoom in level

// --- Interaction ---
let vertexHandleSize = 8;
let grabRadius = 10; // Screen pixels for clicking handle
let edgeClickMinDist = 15; // Screen pixels for clicking edge in add mode
const straightenThreshold = 0.2; // Tolerance for symmetry check (relative coords)

let selectedShapeIndex = -1;
let selectedVertexIndices = []; // <-- Array for multi-select vertex indices
let draggingVertex = false; // Now means dragging selected vertices
let addingVertexMode = false;
let draggingShape = false; // Flag for shape dragging
let dragOccurred = false; // Flag to check if a drag actually moved something

// --- Dragging State ---
let dragVertexStartX = 0; // Screen X (relative to center) where vertex drag started
let dragVertexStartY = 0; // Screen Y (relative to center) where vertex drag started
let dragVertexInitialPositions = []; // Store initial RELATIVE positions [{index, x, y}]

let dragShapeStartX = 0; // ABSOLUTE Screen X where shape drag started
let dragShapeStartY = 0; // ABSOLUTE Screen Y where shape drag started
let dragConstrainedAxis = null; // 'x', 'y', or null

// --- Setup ---
function setup() {
    let canvas = createCanvas(canvasWidth, canvasHeight);
    canvas.parent('main');
    ellipseMode(RADIUS); // Use RADIUS for handle size consistency
    angleMode(DEGREES); // Use DEGREES if needed

    // Calculate max size from definitions for scaling
    maxDefinedShipSize = 1; // Reset default
    for (let key in SHIP_DEFINITIONS) {
        if (SHIP_DEFINITIONS[key]?.size > maxDefinedShipSize) {
            maxDefinedShipSize = SHIP_DEFINITIONS[key].size;
        }
    }
    calculateScale(); // Initial scale calculation

    // --- Get References to UI Elements ---
    instructionsDiv = select('#instructions');
    thargoidWarningSpan = select('#thargoidWarning');
    shipSelector = select('#shipSelect');
    exportButton = select('#exportButton');
    addShapeButton = select('#addShapeButton');
    addVertexButton = select('#addVertexButton');
    fillColorPicker = select('#fillColorPicker');
    strokeColorPicker = select('#strokeColorPicker');
    strokeWeightInput = select('#strokeWeightInput');
    zoomInButton = select('#zoomInButton');
    zoomOutButton = select('#zoomOutButton');
    descriptionDiv = select('#shipDescriptionArea');
    straightenButton = select('#straightenButton');
    undoButton = select('#undoButton');

    // --- Populate Ship Dropdown ---
    shipSelector.option('Select a Ship...');
    shipSelector.option('--- New Blank ---');
    for (let key in SHIP_DEFINITIONS) { shipSelector.option(key); }

    // --- Attach Listeners (with null checks for safety) ---
    shipSelector.changed(handleShipSelection);
    if (exportButton) exportButton.mousePressed(exportDrawFunctionCode); else console.error("Export button not found");
    if (addShapeButton) addShapeButton.mousePressed(addNewShape); else console.error("Add Shape button not found");
    if (addVertexButton) addVertexButton.mousePressed(toggleAddVertexMode); else console.error("Add Vertex button not found");
    if (zoomInButton) zoomInButton.mousePressed(zoomIn); else console.error("Zoom In button not found");
    if (zoomOutButton) zoomOutButton.mousePressed(zoomOut); else console.error("Zoom Out button not found");
    if (fillColorPicker) fillColorPicker.input(updateSelectedShapeFill); else console.error("Fill picker not found");
    if (strokeColorPicker) strokeColorPicker.input(updateSelectedShapeStroke); else console.error("Stroke picker not found");
    if (strokeWeightInput) strokeWeightInput.input(updateSelectedShapeStrokeWeight); else console.error("Stroke weight input not found");
    if (straightenButton) straightenButton.mousePressed(handleStraightenClick); else console.error("Straighten button not found");
    if (undoButton) undoButton.mousePressed(undoLastChange); else console.error("Undo button not found");
    if (descriptionDiv === null) { console.error("Description Div (#shipDescriptionArea) not found!"); }

    // --- Initialize State ---
    handleShipSelection(); // Load initial state (or blank)
    updateUIControls(); // Set initial button disabled states etc.
}

// --- Undo History Functions ---
function saveStateForUndo() {
    try {
        // Basic Validation before saving (optional but good practice)
        for (const shape of shapes) {
            if (!shape || !Array.isArray(shape.vertexData) || !Array.isArray(shape.fillColor) || shape.fillColor.length !== 3 || !Array.isArray(shape.strokeColor) || shape.strokeColor.length !== 3 || typeof shape.strokeW !== 'number') {
                console.error("UNDO SAVE ERROR: Invalid shape structure detected before saving state.", shape);
                return;
            }
            for (const vert of shape.vertexData) {
                if (typeof vert?.x !== 'number' || typeof vert?.y !== 'number' || isNaN(vert.x) || isNaN(vert.y)) {
                    console.error("UNDO SAVE ERROR: Invalid vertex data detected before saving state.", vert);
                    return;
                }
            }
            if (shape.fillColor.some(isNaN) || shape.strokeColor.some(isNaN)) {
                console.error("UNDO SAVE ERROR: NaN found in color data.", shape.fillColor, shape.strokeColor);
                return;
            }
        }

        const stateCopy = JSON.parse(JSON.stringify(shapes)); // Deep copy
        const stateToSave = stateCopy;

        historyStack.push(stateToSave);

        // Limit history size
        if (historyStack.length > maxHistorySize) {
            historyStack.shift(); // Remove the oldest state
        }
        updateUIControls(); // Update button states (enable undo)
    } catch (e) {
        console.error("Error saving state for undo:", e);
        historyStack = []; // Clear history on catastrophic save failure
        updateUIControls();
    }
}

function undoLastChange() {
    if (historyStack.length === 0) {
        console.log("Nothing to undo.");
        return;
    }

    try {
        const previousState = historyStack.pop();
        let restoredShapes = JSON.parse(JSON.stringify(previousState)); // Deep copy

        // --- Validate restored state ---
        let isValidState = true;
        if (!Array.isArray(restoredShapes)) {
            isValidState = false; console.error("UNDO RESTORE ERROR: Restored state is not an array.");
        } else {
            for (let i = 0; i < restoredShapes.length; i++) {
                const shape = restoredShapes[i];
                let shapeValid = true;
                if (!shape) { shapeValid = false; console.error(`UNDO RESTORE ERROR: Shape at index ${i} is null/undefined.`); }
                else if (!Array.isArray(shape.vertexData)) { shapeValid = false; console.error(`UNDO RESTORE ERROR: vertexData missing or not array at index ${i}.`); }
                else if (!Array.isArray(shape.fillColor) || shape.fillColor.length !== 3) { shapeValid = false; console.error(`UNDO RESTORE ERROR: fillColor invalid at index ${i}.`, shape.fillColor); }
                else if (!Array.isArray(shape.strokeColor) || shape.strokeColor.length !== 3) { shapeValid = false; console.error(`UNDO RESTORE ERROR: strokeColor invalid at index ${i}.`, shape.strokeColor); }
                else if (typeof shape.strokeW !== 'number') { shapeValid = false; console.error(`UNDO RESTORE ERROR: strokeW invalid at index ${i}.`, shape.strokeW); }
                else {
                    for (let j = 0; j < shape.vertexData.length; j++) {
                        const vert = shape.vertexData[j];
                        if (!vert || typeof vert.x !== 'number' || typeof vert.y !== 'number' || isNaN(vert.x) || isNaN(vert.y)) {
                            shapeValid = false; console.error(`UNDO RESTORE ERROR: Invalid vertex at shape[${i}], vertex[${j}]:`, vert); break;
                        }
                    }
                    if (shape.fillColor.some(isNaN) || shape.strokeColor.some(isNaN)) {
                        shapeValid = false; console.error(`UNDO RESTORE ERROR: NaN found in color data at index ${i}.`, shape.fillColor, shape.strokeColor);
                    }
                }
                if (!shapeValid) { isValidState = false; break; }
            }
        }

        if (!isValidState) {
            console.error("Undo failed: Restored state is invalid. History might be corrupted.");
            historyStack = []; // Clear corrupted history
            updateUIControls();
            return; // Stop the undo operation
        }

        // Apply the validated state
        shapes = restoredShapes;

        // Reset selections and interaction modes
        selectedShapeIndex = -1;
        selectedVertexIndices = [];
        addingVertexMode = false;
        draggingVertex = false;
        draggingShape = false;
        dragOccurred = false;

        console.log("Undo successful. History size:", historyStack.length);
        updateUIControls(); // Update button states (disable undo if empty)
        updateColorPickersFromSelection(); // Update UI based on the now *deselected* state

    } catch (e) {
        console.error("Error during undo operation:", e);
        historyStack = []; // Clear history on error
        updateUIControls();
    }
}

// --- Helper Function to Calculate Scale ---
function calculateScale() {
    pixelsPerUnit = baseDisplaySize / maxDefinedShipSize;
}

// --- Zoom Functions ---
function zoomIn() {
    baseDisplaySize = min(baseDisplaySize * zoomFactor, maxBaseDisplaySize);
    calculateScale();
}
function zoomOut() {
    baseDisplaySize = max(baseDisplaySize / zoomFactor, minBaseDisplaySize);
    calculateScale();
}

// --- Main Drawing Loop ---
function draw() {
    background(240); // Clear background
    push(); // Isolate transformations
    translate(width / 2, height / 2); // Center origin

    // Draw Grid
    drawGrid(pixelsPerUnit, gridSpacing);

    // Determine the drawing size based on loaded definition or fallback
    let actualDrawSize_s = 0;
    if (currentShipDef) {
        actualDrawSize_s = (currentShipDef.size || 1) * pixelsPerUnit;
    } else if (shapes.length > 0 && currentShipKey === '--- New Blank ---') {
        // Use a fixed size for blank ships relative to max size for consistent initial editing
        actualDrawSize_s = baseDisplaySize * (50 / maxDefinedShipSize);
    }

    // Display placeholder text if nothing is loaded/created
    if (!currentShipDef && shapes.length === 0 && currentShipKey !== '--- New Blank ---') {
        pop(); // Revert translate
        textAlign(CENTER, CENTER); textSize(16); fill(150);
        text("Select a ship or 'New Blank'", width / 2, height / 2);
        return; // Don't draw anything else
    }

    // Proceed with drawing if we have a size or are editing a blank ship
    if (actualDrawSize_s > 0 || (currentShipKey === '--- New Blank ---')) {
        // Calculate radius for drawing (use fallback if size is 0 but drawing blank shapes)
        let scaled_r = actualDrawSize_s / 2;
        let drawing_r = scaled_r > 0 ? scaled_r : baseDisplaySize / (maxDefinedShipSize * 2); // Fallback radius for blank start

        // Draw Thargoid (non-editable) or Editable Shapes
        if (isThargoidSelected()) {
            SHIP_DEFINITIONS.Thargoid.drawFunction(actualDrawSize_s, false);
        } else { // Draw Editable Shapes
            for (let i = shapes.length - 1; i >= 0; i--) { // Draw bottom layers first
                let shape = shapes[i];
                if (shape && shape.vertexData && shape.vertexData.length > 1) {
                    fill(shape.fillColor[0], shape.fillColor[1], shape.fillColor[2]);
                    stroke(shape.strokeColor[0], shape.strokeColor[1], shape.strokeColor[2]);
                    // Scale stroke weight relative to base definition size, prevent zero/negative
                    let scaledStrokeW = max(0.5, (shape.strokeW || 1) * (pixelsPerUnit / (maxDefinedShipSize * 0.5)));
                    strokeWeight(scaledStrokeW);
                    // Highlight selected shape layer
                    if (i === selectedShapeIndex) {
                        strokeWeight(max(1, scaledStrokeW) + 2); stroke(0, 150, 255, 200);
                    }
                    beginShape();
                    for (let v of shape.vertexData) {
                        if (typeof v?.x === 'number' && typeof v?.y === 'number') {
                            vertex(v.x * drawing_r, v.y * drawing_r); // Scale relative coords
                        }
                    }
                    endShape(CLOSE);
                }
            }
        }

        // Draw Vertex Handles for the selected shape (if editable)
        if (selectedShapeIndex !== -1 && selectedShapeIndex < shapes.length && !isThargoidSelected()) {
            let selectedShape = shapes[selectedShapeIndex];
            if (selectedShape && selectedShape.vertexData && drawing_r > 0) {
                for (let i = 0; i < selectedShape.vertexData.length; i++) {
                    let v = selectedShape.vertexData[i];
                    if (typeof v?.x === 'number' && typeof v?.y === 'number') {
                        let screenX = v.x * drawing_r; let screenY = v.y * drawing_r;
                        // Style handles based on selection state
                        if (selectedVertexIndices.includes(i)) { fill(255, 0, 0, 200); stroke(150, 0, 0); }
                        else { fill(0, 100, 200, 180); stroke(0, 50, 150); }
                        strokeWeight(1); // Fixed handle stroke
                        ellipse(screenX, screenY, vertexHandleSize / 2, vertexHandleSize / 2);
                    }
                }
            }
        }
    } else if (currentShipKey !== '--- New Blank ---') {
        pop(); textAlign(CENTER, CENTER); textSize(16); fill(150);
        text("Select a ship or 'New Blank'", width / 2, height / 2);
    }

    pop(); // Revert translate transformation
}

// --- Grid Drawing Function ---
function drawGrid(ppu, spacing) {
    let pixelSpacing = spacing * ppu; // Correct calculation
    if (pixelSpacing < 4) return; // Avoid overly dense grid

    stroke(200, 200, 200, 150); strokeWeight(0.5);
    let halfWidth = width / 2; let halfHeight = height / 2;
    // Draw lines outwards from the center
    for (let x = 0; x <= halfWidth + pixelSpacing; x += pixelSpacing) { line(x, -halfHeight, x, halfHeight); if (x !== 0) line(-x, -halfHeight, -x, halfHeight); }
    for (let y = 0; y <= halfHeight + pixelSpacing; y += pixelSpacing) { line(-halfWidth, y, halfWidth, y); if (y !== 0) line(-halfWidth, -y, halfWidth, -y); }
}

// --- Event Handlers ---
function handleShipSelection() {
    // Reset state variables
    currentShipKey = shipSelector.value(); shapes = []; selectedShapeIndex = -1; selectedVertexIndices = [];
    addingVertexMode = false; draggingShape = false; draggingVertex = false;
    dragConstrainedAxis = null; dragOccurred = false;

    // Clear Undo History for new selection
    historyStack = [];

    let descriptionText = "Select a ship to view its description.";

    // Handle different selection types
    if (currentShipKey === '--- New Blank ---') {
        currentShipDef = null; thargoidWarningSpan.style('display', 'none');
        descriptionText = "Editing a new custom ship design.";
    } else if (SHIP_DEFINITIONS[currentShipKey]) {
        currentShipDef = SHIP_DEFINITIONS[currentShipKey];
        descriptionText = currentShipDef.description || "No description available.";
        // Load vertex data if available and not Thargoid
        if (currentShipDef.vertexData && currentShipDef.vertexData.length > 0 && !isThargoidSelected()) {
            try {
                shapes.push({ // Create initial shape layer (deep copy)
                    vertexData: JSON.parse(JSON.stringify(currentShipDef.vertexData)),
                    fillColor: [...(currentShipDef.fillColor || [180, 180, 180])],
                    strokeColor: [...(currentShipDef.strokeColor || [50, 50, 50])],
                    strokeW: currentShipDef.strokeW || 1
                });
                selectedShapeIndex = 0; // Select the first layer
            } catch (e) {
                console.error("ERROR processing vertexData for", currentShipKey, e);
                selectedShapeIndex = -1; currentShipDef = null; shapes = [];
                descriptionText = "Error loading ship data.";
            }
        } else if (!isThargoidSelected()) {
            console.warn(`Loaded ship '${currentShipKey}' has no editable vertexData or is Thargoid view.`);
            selectedShapeIndex = -1;
        }
        thargoidWarningSpan.style('display', isThargoidSelected() ? 'inline' : 'none');
    } else { // Handle "Select a Ship..."
        currentShipKey = null; currentShipDef = null;
        thargoidWarningSpan.style('display', 'none');
    }

    if (descriptionDiv) { descriptionDiv.html(descriptionText); }
    updateUIControls(); // Update button states
    updateColorPickersFromSelection(); // Reset/set color pickers
}

function isThargoidSelected() {
    return currentShipKey === 'Thargoid' && currentShipDef?.name === 'Thargoid Interceptor';
}

function isEditable() {
    return (currentShipKey === '--- New Blank ---') ||
           (currentShipKey && currentShipKey !== 'Select a Ship...' && currentShipDef && !isThargoidSelected());
}

function mousePressed() {
    // Ignore clicks outside canvas or if Thargoid is displayed
    if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height || isThargoidSelected()) { return; }

    dragOccurred = false; // Reset drag flag

    // Calculate interaction radius and mouse positions
    let actualDrawSize_s = 0;
    if (currentShipDef) { actualDrawSize_s = (currentShipDef.size || 1) * pixelsPerUnit; }
    else if (shapes.length > 0 && currentShipKey === '--- New Blank ---') { actualDrawSize_s = baseDisplaySize * (50 / maxDefinedShipSize); }
    let interaction_r = actualDrawSize_s > 0 ? actualDrawSize_s / 2 : baseDisplaySize / (maxDefinedShipSize * 2);
    let mx_rel = mouseX - width / 2; let my_rel = mouseY - height / 2;
    let mx_shape_rel = mx_rel / interaction_r; let my_shape_rel = my_rel / interaction_r;

    // Reset interaction flags
    draggingVertex = false; draggingShape = false;
    dragVertexInitialPositions = []; dragConstrainedAxis = null;

    // --- 1. Handle Add Vertex Mode ---
    if (addingVertexMode && isEditable() && interaction_r > 0) {
        if (selectedShapeIndex !== -1 && shapes[selectedShapeIndex]) {
            let shape = shapes[selectedShapeIndex];
            if (!shape || !shape.vertexData) { console.error("Add Vertex Failed: Invalid shape"); return; }
            let closestEdgeInfo = findClosestEdgeRelative(shape, mx_shape_rel, my_shape_rel);
            let screenEdgeDistSq = closestEdgeInfo ? distSqToSegment(mx_rel, my_rel,
                shape.vertexData[closestEdgeInfo.index].x * interaction_r, shape.vertexData[closestEdgeInfo.index].y * interaction_r,
                shape.vertexData[(closestEdgeInfo.index + 1) % shape.vertexData.length].x * interaction_r, shape.vertexData[(closestEdgeInfo.index + 1) % shape.vertexData.length].y * interaction_r
            ) : Infinity;

            if (closestEdgeInfo && screenEdgeDistSq < edgeClickMinDist ** 2) {
                saveStateForUndo(); // Save state BEFORE adding vertex
                let v1 = shape.vertexData[closestEdgeInfo.index];
                let v2 = shape.vertexData[(closestEdgeInfo.index + 1) % shape.vertexData.length];
                if (typeof v1?.x !== 'number' || typeof v1?.y !== 'number' || typeof v2?.x !== 'number' || typeof v2?.y !== 'number') { console.error("Add Vertex Failed: Invalid edge points"); return; }
                let newVertex = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 };
                shape.vertexData.splice(closestEdgeInfo.index + 1, 0, newVertex);
                selectedVertexIndices = []; draggingVertex = false;
            }
        }
        updateUIControls(); return; // Stop processing
    }

    // --- 2. Check for Vertex Handle Click ---
    let clickedVertexHandleIndex = -1;
    if (isEditable() && selectedShapeIndex !== -1 && shapes[selectedShapeIndex]?.vertexData && interaction_r > 0) {
        let selectedShape = shapes[selectedShapeIndex];
        for (let i = 0; i < selectedShape.vertexData.length; i++) {
            let v = selectedShape.vertexData[i];
            if (typeof v?.x !== 'number' || typeof v?.y !== 'number') continue;
            let screenX = v.x * interaction_r; let screenY = v.y * interaction_r;
            if (distSq(mx_rel, my_rel, screenX, screenY) < grabRadius ** 2) {
                clickedVertexHandleIndex = i; break;
            }
        }
    }

    // --- Action if Vertex Handle Clicked ---
    if (clickedVertexHandleIndex !== -1) {
        let indexInSelection = selectedVertexIndices.indexOf(clickedVertexHandleIndex);
        let currentlySelected = indexInSelection !== -1;

        if (keyIsDown(SHIFT)) { // Toggle selection (No state change needing undo)
            if (currentlySelected) { selectedVertexIndices.splice(indexInSelection, 1); }
            else { selectedVertexIndices.push(clickedVertexHandleIndex); }
        } else { // Prepare for drag
            if (!currentlySelected) { selectedVertexIndices = [clickedVertexHandleIndex]; }
            saveStateForUndo(); // SAVE STATE BEFORE starting vertex drag
            draggingVertex = true; // Set flag AFTER saving
            dragVertexStartX = mx_rel; dragVertexStartY = my_rel;
            dragVertexInitialPositions = [];
            let shape = shapes[selectedShapeIndex];
            if (shape?.vertexData) {
                selectedVertexIndices.forEach(idx => {
                    if (shape.vertexData[idx]) { dragVertexInitialPositions.push({ index: idx, x: shape.vertexData[idx].x, y: shape.vertexData[idx].y }); }
                });
            }
            draggingShape = false;
        }
        updateUIControls(); return; // Interaction handled
    }
    draggingVertex = false; // Ensure flag is false if no handle click

    // --- 3. Check for Shape Click (Selection / Drag Initiation) ---
    let clickedShapeIndex = -1; let clickedInsideSelectedShape = false;
    for (let i = 0; i < shapes.length; i++) { // Check top-down
        let currentShape = shapes[i];
        if (currentShape?.vertexData?.length >= 3 && isPointInPolygon(mx_shape_rel, my_shape_rel, currentShape.vertexData)) {
            clickedShapeIndex = i;
            if (i === selectedShapeIndex) clickedInsideSelectedShape = true;
            break; // Found topmost hit
        }
    }

    // --- Action based on Shape Click ---
    if (clickedShapeIndex !== -1) { // Clicked inside *some* shape
        if (clickedInsideSelectedShape && isEditable()) { // Clicked selected shape: Start drag
            saveStateForUndo(); // SAVE STATE BEFORE starting shape drag
            draggingShape = true; // Set flag AFTER saving
            dragShapeStartX = mouseX; dragShapeStartY = mouseY;
            selectedVertexIndices = []; // Deselect vertices
        } else if (selectedShapeIndex !== clickedShapeIndex && isEditable()) { // Clicked different shape: Select it (No undo needed for selection change)
            selectedShapeIndex = clickedShapeIndex; selectedVertexIndices = [];
            draggingShape = false; updateColorPickersFromSelection();
        }
    } else { // Clicked outside any shape: Deselect (No undo needed)
        if (selectedShapeIndex !== -1) {
            selectedShapeIndex = -1; selectedVertexIndices = [];
            updateColorPickersFromSelection();
        }
        draggingShape = false;
    }
    updateUIControls();
}

function mouseDragged() {
    // Ignore if Thargoid selected or not currently dragging anything
    if (isThargoidSelected() || (!draggingVertex && !draggingShape)) return;

    // Set flag if actual movement occurs beyond a small threshold
    if (!dragOccurred) {
        let moved = false;
        if (draggingVertex) { moved = distSq(mouseX - width/2, mouseY - height/2, dragVertexStartX, dragVertexStartY) > 4; }
        else if (draggingShape) { moved = distSq(mouseX, mouseY, dragShapeStartX, dragShapeStartY) > 4; }
        if (moved) dragOccurred = true;
    }

    // Recalculate interaction radius
    let actualDrawSize_s = 0;
    if (currentShipDef) { actualDrawSize_s = (currentShipDef.size || 1) * pixelsPerUnit; }
    else if (shapes.length > 0 && currentShipKey === '--- New Blank ---') { actualDrawSize_s = baseDisplaySize * (50 / maxDefinedShipSize); }
    let interaction_r = actualDrawSize_s > 0 ? actualDrawSize_s / 2 : baseDisplaySize / (maxDefinedShipSize * 2);

    // --- Handle Multi-Vertex Dragging ---
    if (draggingVertex && selectedShapeIndex !== -1 && shapes[selectedShapeIndex]?.vertexData && isEditable()) {
        let shape = shapes[selectedShapeIndex];
        let currentMxRel = mouseX - width / 2; let currentMyRel = mouseY - height / 2;
        let deltaScreenX = currentMxRel - dragVertexStartX; let deltaScreenY = currentMyRel - dragVertexStartY;
        // Apply Axis Constraint Logic (Shift Key)
        if (keyIsDown(SHIFT)) {
            if (dragConstrainedAxis === null && (abs(deltaScreenX) > 5 || abs(deltaScreenY) > 5)) { dragConstrainedAxis = abs(deltaScreenX) > abs(deltaScreenY) ? 'x' : 'y'; }
            if (dragConstrainedAxis === 'x') { deltaScreenY = 0; } else if (dragConstrainedAxis === 'y') { deltaScreenX = 0; }
        } else { dragConstrainedAxis = null; }
        // Convert screen delta to relative delta and apply
        let deltaRelX = deltaScreenX / interaction_r; let deltaRelY = deltaScreenY / interaction_r;
        dragVertexInitialPositions.forEach(initialPos => {
            if (shape.vertexData[initialPos.index]) {
                shape.vertexData[initialPos.index].x = initialPos.x + deltaRelX;
                shape.vertexData[initialPos.index].y = initialPos.y + deltaRelY;
            }
        });
    }
    // --- Handle Shape Dragging ---
    else if (draggingShape && selectedShapeIndex !== -1 && shapes[selectedShapeIndex]?.vertexData && isEditable()) {
        let shape = shapes[selectedShapeIndex];
        let dx = mouseX - pmouseX; let dy = mouseY - pmouseY; // Frame delta
        // Apply Axis Constraint Logic (Shift Key)
        if (keyIsDown(SHIFT)) {
            if (dragConstrainedAxis === null && distSq(mouseX, mouseY, dragShapeStartX, dragShapeStartY) > 25) {
                 let totalDx = mouseX - dragShapeStartX; let totalDy = mouseY - dragShapeStartY;
                 dragConstrainedAxis = abs(totalDx) > abs(totalDy) ? 'x' : 'y';
            }
            if (dragConstrainedAxis === 'x') { dy = 0; } else if (dragConstrainedAxis === 'y') { dx = 0; }
        } else { dragConstrainedAxis = null; }
        // Convert screen delta to relative delta and apply
        let deltaRelX = dx / interaction_r; let deltaRelY = dy / interaction_r;
        for (let v of shape.vertexData) {
            if (typeof v?.x === 'number' && typeof v?.y === 'number') { v.x += deltaRelX; v.y += deltaRelY; }
        }
    }
}

function mouseReleased() {
    // NOTE: State saving for drags is now done in mousePressed.
    // This function just resets flags.

    if (draggingVertex) draggingVertex = false;
    if (draggingShape) draggingShape = false;
    dragVertexInitialPositions = [];
    dragConstrainedAxis = null;
    dragOccurred = false; // Reset drag occurred flag
}

function keyPressed() {
    if (isThargoidSelected()) return; // Ignore keys if Thargoid selected

    // Delete Selected Vertices (DELETE or BACKSPACE without Shift)
    if ((keyCode === DELETE || keyCode === BACKSPACE) && !keyIsDown(SHIFT) && selectedShapeIndex !== -1 && selectedVertexIndices.length > 0 && isEditable()) {
        if (shapes[selectedShapeIndex]?.vertexData) {
            let shape = shapes[selectedShapeIndex];
            let remainingVertices = shape.vertexData.length - selectedVertexIndices.length;
            if (remainingVertices >= 3) { // Check if deletion is valid
                saveStateForUndo(); // Save state BEFORE deleting vertices
                shape.vertexData = shape.vertexData.filter((_, index) => !selectedVertexIndices.includes(index));
                selectedVertexIndices = []; draggingVertex = false; // Reset selection/interaction
            } else { console.warn(`Cannot delete vertices - must leave at least 3.`); }
        }
    }
    // Delete Selected Shape Layer (SHIFT + DELETE or BACKSPACE)
    else if ((keyCode === DELETE || keyCode === BACKSPACE) && keyIsDown(SHIFT) && selectedShapeIndex !== -1 && isEditable()) {
        if (shapes.length > selectedShapeIndex && selectedShapeIndex >= 0) {
            saveStateForUndo(); // Save state BEFORE deleting shape layer
            shapes.splice(selectedShapeIndex, 1); // Remove the shape layer
            selectedShapeIndex = -1; selectedVertexIndices = []; // Reset selection
            draggingVertex = false; draggingShape = false;
            updateUIControls(); updateColorPickersFromSelection(); // Update UI
        }
    }
    // Add Ctrl+Z / Cmd+Z for Undo
    else if (key === 'z' && (keyIsDown(CONTROL) || keyIsDown(COMMAND))) {
        undoLastChange();
    }
}

// --- UI Update Functions ---
function updateUIControls() {
    let editable = isEditable();
    let shapeSelected = selectedShapeIndex !== -1 && editable && shapes[selectedShapeIndex];

    // Enable/disable buttons based on state
    if (addShapeButton?.elt) addShapeButton.elt.disabled = !editable && currentShipKey !== '--- New Blank ---';
    if (exportButton?.elt) exportButton.elt.disabled = shapes.length === 0 && !isThargoidSelected();
    if (straightenButton?.elt) straightenButton.elt.disabled = !shapeSelected;
    if (undoButton?.elt) undoButton.elt.disabled = historyStack.length === 0;

    // Disable editing tools if no editable shape is selected
    const shouldBeDisabled = !shapeSelected;
    if (addVertexButton?.elt) addVertexButton.elt.disabled = shouldBeDisabled;
    if (fillColorPicker?.elt) fillColorPicker.elt.disabled = shouldBeDisabled;
    if (strokeColorPicker?.elt) strokeColorPicker.elt.disabled = shouldBeDisabled;
    if (strokeWeightInput?.elt) strokeWeightInput.elt.disabled = shouldBeDisabled;

    // Handle 'Add Vertex Mode' button state
    if (shouldBeDisabled && addingVertexMode) addingVertexMode = false; // Turn off mode if disabled
    if (addVertexButton) {
        if (addingVertexMode && shapeSelected) { addVertexButton.addClass('active'); }
        else { addVertexButton.removeClass('active'); }
    }
    if (addingVertexMode && !shapeSelected) addingVertexMode = false; // Ensure mode variable matches
}

function updateColorPickersFromSelection() {
    if (selectedShapeIndex !== -1 && selectedShapeIndex < shapes.length && shapes[selectedShapeIndex]) {
        let shape = shapes[selectedShapeIndex];
        // Validate shape data before updating pickers
        if (shape && Array.isArray(shape.fillColor) && shape.fillColor.length === 3 && !shape.fillColor.some(isNaN) &&
            Array.isArray(shape.strokeColor) && shape.strokeColor.length === 3 && !shape.strokeColor.some(isNaN) &&
            typeof shape.strokeW === 'number' && !isNaN(shape.strokeW))
        {
            if (fillColorPicker) fillColorPicker.value(rgbToHex(shape.fillColor));
            if (strokeColorPicker) strokeColorPicker.value(rgbToHex(shape.strokeColor));
            if (strokeWeightInput) strokeWeightInput.value(shape.strokeW);
        } else {
            console.warn("Selected shape has invalid color/style data. Resetting pickers.", shape);
            // Reset pickers to default if data is bad
            if (fillColorPicker) fillColorPicker.value('#cccccc');
            if (strokeColorPicker) strokeColorPicker.value('#333333');
            if (strokeWeightInput) strokeWeightInput.value(1);
        }
    } else {
        // Reset pickers to default values if nothing is selected
        if (fillColorPicker) fillColorPicker.value('#cccccc');
        if (strokeColorPicker) strokeColorPicker.value('#333333');
        if (strokeWeightInput) strokeWeightInput.value(1);
    }
}

function updateSelectedShapeFill() {
    if (selectedShapeIndex !== -1 && shapes[selectedShapeIndex] && isEditable()) {
        saveStateForUndo(); // Save state BEFORE change
        let col = color(fillColorPicker.value());
        shapes[selectedShapeIndex].fillColor = [red(col), green(col), blue(col)];
    }
}
function updateSelectedShapeStroke() {
    if (selectedShapeIndex !== -1 && shapes[selectedShapeIndex] && isEditable()) {
        saveStateForUndo(); // Save state BEFORE change
        let col = color(strokeColorPicker.value());
        shapes[selectedShapeIndex].strokeColor = [red(col), green(col), blue(col)];
    }
}
function updateSelectedShapeStrokeWeight() {
    if (selectedShapeIndex !== -1 && shapes[selectedShapeIndex] && isEditable()) {
        saveStateForUndo(); // Save state BEFORE change
        shapes[selectedShapeIndex].strokeW = parseFloat(strokeWeightInput.value()) || 0;
    }
}

// --- Action Functions ---
function addNewShape() {
    if (!isEditable() && currentShipKey !== '--- New Blank ---') return;
    saveStateForUndo(); // Save state BEFORE adding
    let defaultShape = {
        vertexData: [{ x: -0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0, y: -0.2 }],
        fillColor: [150, 150, 180], strokeColor: [50, 50, 60], strokeW: 1
    };
    shapes.unshift(defaultShape); // Add to top
    selectedShapeIndex = 0; selectedVertexIndices = []; // Select new shape
    if (currentShipKey === null || currentShipKey === 'Select a Ship...') {
        currentShipKey = '--- New Blank ---'; currentShipDef = null;
    }
    updateUIControls(); updateColorPickersFromSelection();
}

function toggleAddVertexMode() {
    if (selectedShapeIndex !== -1 && isEditable() && shapes[selectedShapeIndex]) {
        addingVertexMode = !addingVertexMode;
        if (addingVertexMode) { // Reset interaction state when entering mode
            draggingVertex = false; selectedVertexIndices = []; draggingShape = false;
        }
        updateUIControls(); // Update button style
    } else { // Ensure mode is off if conditions not met
        if (addingVertexMode) { addingVertexMode = false; updateUIControls(); }
    }
}

function handleStraightenClick() {
    if (selectedShapeIndex !== -1 && isEditable() && shapes[selectedShapeIndex]) {
        saveStateForUndo(); // Save state BEFORE modifying vertices
        straightenMirroredVertices(shapes[selectedShapeIndex], straightenThreshold);
    }
}

function straightenMirroredVertices(shape, threshold) {
    // Attempts to align vertices that appear mirrored across X or Y axes
    if (!shape?.vertexData || shape.vertexData.length < 2) { return; }
    let vertices = shape.vertexData; let numVertices = vertices.length;
    let processed = new Set(); let adjustmentsMade = 0;

    // 1. Snap points close to axes
    for (let i = 0; i < numVertices; i++) {
        let v = vertices[i]; let snapped = false;
        if (abs(v.x) < threshold / 2 && v.x !== 0) { v.x = 0; snapped = true; }
        if (abs(v.y) < threshold / 2 && v.y !== 0) { v.y = 0; snapped = true; }
        if (snapped) { adjustmentsMade++; }
    }

    // 2. Find and adjust mirrored pairs
    for (let i = 0; i < numVertices; i++) {
        if (processed.has(i)) continue;
        let v_i = vertices[i];
        for (let j = i + 1; j < numVertices; j++) {
            if (processed.has(j)) continue;
            let v_j = vertices[j];
            // Check X-mirror (x1≈x2, y1≈-y2), avoiding both near y=0
            if ((abs(v_i.y) > threshold / 4 || abs(v_j.y) > threshold / 4) && abs(v_i.x - v_j.x) < threshold && abs(v_i.y + v_j.y) < threshold) {
                let newX = (v_i.x + v_j.x) / 2; let newAbsY = (abs(v_i.y) + abs(v_j.y)) / 2;
                let sign_i = Math.sign(v_i.y) || (v_j.y === 0 ? 1 : -Math.sign(v_j.y)) || 1;
                v_i.x = newX; v_j.x = newX; v_i.y = newAbsY * sign_i; v_j.y = -newAbsY * sign_i;
                processed.add(i); processed.add(j); adjustmentsMade++; break;
            }
            // Check Y-mirror (x1≈-x2, y1≈y2), avoiding both near x=0
            else if ((abs(v_i.x) > threshold / 4 || abs(v_j.x) > threshold / 4) && abs(v_i.x + v_j.x) < threshold && abs(v_i.y - v_j.y) < threshold) {
                let newY = (v_i.y + v_j.y) / 2; let newAbsX = (abs(v_i.x) + abs(v_j.x)) / 2;
                let sign_i = Math.sign(v_i.x) || (v_j.x === 0 ? 1 : -Math.sign(v_j.x)) || 1;
                v_i.y = newY; v_j.y = newY; v_i.x = newAbsX * sign_i; v_j.x = -newAbsX * sign_i;
                processed.add(i); processed.add(j); adjustmentsMade++; break;
            }
        }
    }
    if (adjustmentsMade > 0) console.log(`Straighten Symmetry: Made ${adjustmentsMade} adjustments.`);
    else console.log("Straighten Symmetry: No adjustments needed.");
}

// Inside editor.js
function exportDrawFunctionCode() {
    // Generates JavaScript code for a draw function AND the first layer's data format
    let baseName = 'CustomShip';
    if (currentShipDef && currentShipKey !== '--- New Blank ---') {
        baseName = currentShipKey.replace(/\s+/g, '').replace('Mk', 'Mk');
    }
    let functionName = `draw${baseName}_Edited`;
    let code = [];
    code.push(`// --- Generated Export for ${baseName} (Edited) ---`);
    code.push(`// --- Contains ${shapes.length} shape layer(s) ---`);
    code.push(`//`);

    // --- Format 1: First Layer Data (as requested) ---
    code.push(`// --- Format 1: Data for the First Shape Layer (Index 0) ---`);
    if (shapes.length > 0 && shapes[0] && shapes[0].vertexData && shapes[0].vertexData.length >= 2) {
        let firstShape = shapes[0];
        let vertexDataString = 'vertexData: [ ';
        vertexDataString += firstShape.vertexData.map(v => `{ x: ${v.x.toFixed(4)}, y: ${v.y.toFixed(4)} }`).join(', ');
        vertexDataString += ' ],';
        code.push(vertexDataString);

        let fillColorString = `fillColor: [${firstShape.fillColor ? firstShape.fillColor.map(c => Math.round(c)).join(', ') : '180, 180, 180'}],`;
        code.push(`        ${fillColorString}`); // Indent for readability within the block

        let strokeColorString = `strokeColor: [${firstShape.strokeColor ? firstShape.strokeColor.map(c => Math.round(c)).join(', ') : '50, 50, 50'}],`;
        code.push(`        ${strokeColorString}`); // Indent

        let strokeWString = `strokeW: ${typeof firstShape.strokeW === 'number' ? firstShape.strokeW.toFixed(2) : 1}`;
        code.push(`        ${strokeWString}`); // Indent
    } else {
        code.push(`// --- No valid first shape layer found to export data for ---`);
    }
    code.push(`// --- End Format 1 ---`);
    code.push(``);
    code.push(`//`);

    // --- Format 2: Full Draw Function (existing logic) ---
    code.push(`// --- Format 2: Complete Draw Function (Includes All Layers) ---`);
    code.push(`// --- Base Ship Size (for reference): ${currentShipDef ? currentShipDef.size : 'N/A (Custom)'} ---`);
    code.push(`function ${functionName}(s, thrusting = false) {`);
    code.push(`    let r = s / 2; // Calculate radius based on the desired draw size 's'`);
    code.push(``);
    // Iterate shapes in reverse drawing order (bottom first)
    for (let i = shapes.length - 1; i >= 0; i--) {
        let shape = shapes[i];
        if (!shape?.vertexData || shape.vertexData.length < 2) continue;
        code.push(`    // --- Shape Layer ${shapes.length - i} (Index ${i} in editor) ---`);
        code.push(`    fill(${shape.fillColor ? shape.fillColor.map(c => Math.round(c)).join(', ') : '150, 150, 150'});`); // Use Math.round for cleaner output
        code.push(`    stroke(${shape.strokeColor ? shape.strokeColor.map(c => Math.round(c)).join(', ') : '50, 50, 50'});`); // Use Math.round
        code.push(`    strokeWeight(max(0.5, ${typeof shape.strokeW === 'number' ? shape.strokeW.toFixed(2) : 1}));`); // keep max for safety
        code.push(`    beginShape();`);
        shape.vertexData.forEach(v => {
            if (typeof v?.x === 'number' && typeof v?.y === 'number') {
                code.push(`    vertex(r * ${v.x.toFixed(4)}, r * ${v.y.toFixed(4)});`);
            }
        });
        code.push(`    endShape(CLOSE);`); code.push(``);
    };
    // Attempt to copy engine glow code
    if (currentShipDef && currentShipKey !== '--- New Blank ---' && currentShipDef.drawFunction) {
        try {
            let originalFuncStr = currentShipDef.drawFunction.toString();
            // More robust regex to capture the 'if (thrusting)' block, handling variations in spacing and potential comments
            let engineGlowMatch = originalFuncStr.match(/if\s*\(\s*thrusting\s*\)\s*\{([\s\S]*?)\}\s*(?:;|\n|\r\n)?\s*(?![^{]*\{)/);

            if (engineGlowMatch && engineGlowMatch[1]) {
                code.push(`    // --- Engine glow (attempted copy from original base: ${currentShipDef.name}) ---`);
                // Basic re-indentation
                let glowCode = engineGlowMatch[1].trim().split('\n').map(line => '    ' + line.trim()).join('\n');
                code.push(`    if (thrusting) {`); code.push(glowCode); code.push(`    }`); code.push(``);
            } else {
                console.warn(`Engine glow block not matched in ${currentShipDef.name}. Regex might need adjustment or function structure differs.`);
                code.push(`    // --- Engine glow code not found or matched in base function structure ---`); code.push(``);
            }
        } catch (e) { console.error("Error copying engine glow code:", e); code.push(`    // --- Error encountered trying to copy engine glow code ---`); code.push(``); }
    } else { code.push(`    // --- No engine glow defined for base (or custom ship) ---`); code.push(``); }
    code.push(`}`); code.push(`// --- End Format 2 ---`);
    code.push(`// --- End Generated Function ---`); // Kept original ending comment

    saveStrings(code, `${functionName}_ExportData.js`, 'js'); // Update filename slightly
}

// --- Utility Functions ---
function isPointInPolygon(px, py, polygonVertices) {
    if (!polygonVertices || polygonVertices.length < 3) return false;
    let isInside = false;
    for (let i = 0, j = polygonVertices.length - 1; i < polygonVertices.length; j = i++) {
        let vi = polygonVertices[i]; let vj = polygonVertices[j];
        if (typeof vi?.x !== 'number' || typeof vi?.y !== 'number' || typeof vj?.x !== 'number' || typeof vj?.y !== 'number') { continue; }
        let xi = vi.x, yi = vi.y; let xj = vj.x, yj = vj.y;
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) { isInside = !isInside; }
    } return isInside;
}

function findClosestEdgeRelative(shape, mx_rel_shape, my_rel_shape) {
    let minDistSq = Infinity; let closestEdgeIndex = -1;
    if (!shape?.vertexData || shape.vertexData.length < 2) return null;
    for (let i = 0; i < shape.vertexData.length; i++) {
        let v1 = shape.vertexData[i]; let v2 = shape.vertexData[(i + 1) % shape.vertexData.length];
        if (typeof v1?.x !== 'number' || typeof v1?.y !== 'number' || typeof v2?.x !== 'number' || typeof v2?.y !== 'number') continue;
        let distSq = distSqToSegment(mx_rel_shape, my_rel_shape, v1.x, v1.y, v2.x, v2.y);
        if (distSq < minDistSq) { minDistSq = distSq; closestEdgeIndex = i; }
    }
    if (closestEdgeIndex !== -1) { return { index: closestEdgeIndex, distSq: minDistSq }; }
    return null;
}

function distSqToSegment(px, py, x1, y1, x2, y2) {
    let l2 = distSq(x1, y1, x2, y2); if (l2 === 0) return distSq(px, py, x1, y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    let projX = x1 + t * (x2 - x1); let projY = y1 + t * (y2 - y1);
    return distSq(px, py, projX, projY);
}

function distSq(x1, y1, x2, y2) {
    let dx = x1 - x2; let dy = y1 - y2; return dx * dx + dy * dy;
}

function rgbToHex(rgb) {
    // Converts [r, g, b] array to hex "#rrggbb" string with validation
    if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some(val => typeof val !== 'number' || isNaN(val))) {
        console.error("Invalid input to rgbToHex:", rgb); return "#000000";
    }
    try {
        return '#' + rgb.map(x => {
            const hex = Math.round(constrain(x, 0, 255)).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
    } catch (e) { console.error("Error converting RGB to Hex:", rgb, e); return "#000000"; }
}

// --- Log successful load ---
console.log("editor.js loaded successfully with all features (v3 - Correct Drag Undo).");