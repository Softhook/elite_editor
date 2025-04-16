// ****** editor.js ******
// Logic for the p5.js ship editor - ENHANCED with multi-shape, add vertex, color edit
// VERSION WITH relative scaling, grid, zoom, shape dragging, multi-vertex select, fixes
// +++ Added Axis-Constrained Dragging (Shift Key) +++

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

let currentShipKey = null; // Key ("Sidewinder", "CobraMkIII", etc.) or "--- New Blank ---"
let currentShipDef = null; // The original definition object (if loaded)
let shapes = []; // Array of shape objects: { vertexData: [{x,y},...], fillColor: [r,g,b], strokeColor: [r,g,b], strokeW: number }

// --- Display & Scaling ---
let canvasWidth = 600;
let canvasHeight = 450;
let baseDisplaySize = 350; // Initial Max drawing size (represents current zoom)
let maxDefinedShipSize = 1; // Will be calculated from definitions
let pixelsPerUnit = 1; // Scale factor: pixels / ship size unit
let gridSpacing = 25; // World units between grid lines

// --- Zoom Control ---
const zoomFactor = 1.2; // How much to zoom per click
const minBaseDisplaySize = 50; // Min zoom out level (in pixels for largest ship)
const maxBaseDisplaySize = 2000; // Max zoom in level

// --- Interaction ---
let vertexHandleSize = 8;
let grabRadius = 10;
let edgeClickMinDist = 15;

let selectedShapeIndex = -1;
let selectedVertexIndices = []; // <-- Array for multi-select vertex indices
let draggingVertex = false; // Now means dragging selected vertices
let addingVertexMode = false;
let draggingShape = false; // Flag for shape dragging

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
    ellipseMode(RADIUS);
    angleMode(DEGREES);

    maxDefinedShipSize = 1;
    for (let key in SHIP_DEFINITIONS) {
        if (SHIP_DEFINITIONS[key]?.size > maxDefinedShipSize) { // Added safety check
            maxDefinedShipSize = SHIP_DEFINITIONS[key].size;
        }
    }
    calculateScale();

    // --- Get References ---
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

    // --- Populate Dropdown ---
    shipSelector.option('Select a Ship...');
    shipSelector.option('--- New Blank ---');
    for (let key in SHIP_DEFINITIONS) { shipSelector.option(key); }

    // --- Attach Listeners (with null checks) ---
    shipSelector.changed(handleShipSelection);
    if (exportButton) exportButton.mousePressed(exportDrawFunctionCode); else console.error("Export button not found");
    if (addShapeButton) addShapeButton.mousePressed(addNewShape); else console.error("Add Shape button not found");
    if (addVertexButton) addVertexButton.mousePressed(toggleAddVertexMode); else console.error("Add Vertex button not found");
    if (zoomInButton) zoomInButton.mousePressed(zoomIn); else console.error("Zoom In button not found");
    if (zoomOutButton) zoomOutButton.mousePressed(zoomOut); else console.error("Zoom Out button not found");
    if (fillColorPicker) fillColorPicker.input(updateSelectedShapeFill); else console.error("Fill picker not found");
    if (strokeColorPicker) strokeColorPicker.input(updateSelectedShapeStroke); else console.error("Stroke picker not found");
    if (strokeWeightInput) strokeWeightInput.input(updateSelectedShapeStrokeWeight); else console.error("Stroke weight input not found");
    if (descriptionDiv === null) { console.error("Description Div (#shipDescriptionArea) not found!"); }

    // --- Initialize ---
    handleShipSelection();
    updateUIControls();
}

// --- Helper Function to Calculate Scale ---
function calculateScale() { pixelsPerUnit = baseDisplaySize / maxDefinedShipSize; }

// --- Zoom Functions ---
function zoomIn() { baseDisplaySize = min(baseDisplaySize * zoomFactor, maxBaseDisplaySize); calculateScale(); }
function zoomOut() { baseDisplaySize = max(baseDisplaySize / zoomFactor, minBaseDisplaySize); calculateScale(); }

// --- Main Drawing Loop ---
function draw() {
    background(240);
    push();
    translate(width / 2, height / 2);
    drawGrid(pixelsPerUnit, gridSpacing);

    let actualDrawSize_s = 0;
    if (currentShipDef) { actualDrawSize_s = (currentShipDef.size || 1) * pixelsPerUnit; }
    else if (shapes.length > 0 && currentShipKey === '--- New Blank ---') { actualDrawSize_s = 50 * pixelsPerUnit; }

    if (!currentShipDef && shapes.length === 0 && currentShipKey !== '--- New Blank ---') {
        pop(); textAlign(CENTER, CENTER); textSize(16); fill(150); text("Select a ship or 'New Blank'", width / 2, height / 2); return;
    }

    if (actualDrawSize_s > 0 || (currentShipKey === '--- New Blank ---')) {
        let scaled_r = actualDrawSize_s / 2;

        if (isThargoidSelected()) { SHIP_DEFINITIONS.Thargoid.drawFunction(actualDrawSize_s, false); }
        else { // Draw Editable Shapes
            for (let i = shapes.length - 1; i >= 0; i--) {
                let shape = shapes[i];
                if (shape && shape.vertexData && shape.vertexData.length > 1) {
                    fill(shape.fillColor[0], shape.fillColor[1], shape.fillColor[2]);
                    stroke(shape.strokeColor[0], shape.strokeColor[1], shape.strokeColor[2]);
                    let scaledStrokeW = max(0.5, shape.strokeW * (pixelsPerUnit / 2));
                    strokeWeight(scaledStrokeW);
                    if (i === selectedShapeIndex) {
                        strokeWeight(max(1, scaledStrokeW) + 2); stroke(0, 150, 255, 200);
                    }
                    beginShape();
                    for (let v of shape.vertexData) {
                        if (typeof v?.x === 'number' && typeof v?.y === 'number') { vertex(v.x * scaled_r, v.y * scaled_r); }
                    } endShape(CLOSE);
                }
            }
        }

        // Draw Handles (Checks selectedVertexIndices)
        if (selectedShapeIndex !== -1 && selectedShapeIndex < shapes.length && !isThargoidSelected()) {
             let selectedShape = shapes[selectedShapeIndex];
             if (selectedShape && selectedShape.vertexData && scaled_r > 0) {
                 for (let i = 0; i < selectedShape.vertexData.length; i++) {
                    let v = selectedShape.vertexData[i];
                    if (typeof v?.x === 'number' && typeof v?.y === 'number') {
                        let screenX = v.x * scaled_r; let screenY = v.y * scaled_r;
                        if (selectedVertexIndices.includes(i)) { fill(255, 0, 0, 200); stroke(150, 0, 0); }
                        else { fill(0, 100, 200, 180); stroke(0, 50, 150); }
                         strokeWeight(1);
                        ellipse(screenX, screenY, vertexHandleSize / 2, vertexHandleSize / 2);
                    }
                 }
             }
        }
    } else if (currentShipKey !== '--- New Blank ---') {
         pop(); textAlign(CENTER, CENTER); textSize(16); fill(150); text("Select a ship or 'New Blank'", width / 2, height / 2);
    }
    pop();
}

// --- Grid Drawing Function ---
function drawGrid(ppu, spacing) {
    let pixelSpacing = spacing * ppu; if (pixelSpacing < 4) return;
    stroke(200, 200, 200, 150); strokeWeight(0.5);
    let halfWidth = width / 2; let halfHeight = height / 2;
    for (let x = 0; x <= halfWidth + pixelSpacing; x += pixelSpacing) { line(x, -halfHeight, x, halfHeight); if (x !== 0) line(-x, -halfHeight, -x, halfHeight); }
    for (let y = 0; y <= halfHeight + pixelSpacing; y += pixelSpacing) { line(-halfWidth, y, halfWidth, y); if (y !== 0) line(-halfWidth, -y, halfWidth, -y); }
}

// --- Event Handlers ---
function handleShipSelection() {
    currentShipKey = shipSelector.value(); shapes = []; selectedShapeIndex = -1;
    selectedVertexIndices = []; addingVertexMode = false; draggingShape = false; draggingVertex = false;
    dragConstrainedAxis = null; // Reset constraint

    let descriptionText = "Select a ship to view its description.";

    if (currentShipKey === '--- New Blank ---') { currentShipDef = null; thargoidWarningSpan.style('display', 'none'); descriptionText = "Editing a new custom ship design."; }
    else if (SHIP_DEFINITIONS[currentShipKey]) {
        currentShipDef = SHIP_DEFINITIONS[currentShipKey];
        descriptionText = currentShipDef.description || "No description available.";
        if (currentShipDef.vertexData && currentShipDef.vertexData.length > 0) {
             try { shapes.push({ vertexData: JSON.parse(JSON.stringify(currentShipDef.vertexData)), fillColor: [...(currentShipDef.fillColor || [180, 180, 180])], strokeColor: [...(currentShipDef.strokeColor || [50, 50, 50])], strokeW: currentShipDef.strokeW || 1 }); selectedShapeIndex = 0; }
             catch (e) { console.error("ERROR processing vertexData", currentShipKey, e); selectedShapeIndex = -1; currentShipDef = null; descriptionText = "Error loading ship data."; }
        } else if (!isThargoidSelected()) { console.warn(`Loaded ship '${currentShipKey}' has no editable vertexData.`); selectedShapeIndex = -1; }
        thargoidWarningSpan.style('display', isThargoidSelected() ? 'inline' : 'none');
    } else { currentShipKey = null; currentShipDef = null; thargoidWarningSpan.style('display', 'none'); }

    if (descriptionDiv) { descriptionDiv.html(descriptionText); }
    updateUIControls(); updateColorPickersFromSelection();
}
function isThargoidSelected() { return currentShipKey === 'Thargoid' && currentShipDef?.name === 'Thargoid Interceptor'; }
function isEditable() { return (currentShipKey === '--- New Blank ---') || (currentShipKey && currentShipKey !== 'Select a Base...' && currentShipDef && !isThargoidSelected()); }


// ** mousePressed updated for Correct Top-Most Shape Selection **
function mousePressed() {
    if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) { return; } // Ignore clicks outside canvas
    if (!isEditable() && !isThargoidSelected()) { return; }

    // --- Calculate Scaled Radius ---
    let actualDrawSize_s = 0;
    if (currentShipDef) { actualDrawSize_s = (currentShipDef.size || 1) * pixelsPerUnit; }
    else if (shapes.length > 0 && currentShipKey === '--- New Blank ---') { actualDrawSize_s = 50 * pixelsPerUnit; }
    if (actualDrawSize_s <= 0 && currentShipKey !== '--- New Blank ---') return;
    let interaction_r = actualDrawSize_s > 0 ? actualDrawSize_s / 2 : 1;

    let mx_rel = mouseX - width / 2;
    let my_rel = mouseY - height / 2;

    // Reset drag flags
    draggingVertex = false; draggingShape = false;
    dragVertexInitialPositions = []; dragConstrainedAxis = null;

    // --- 1. Add Vertex Mode ---
    if (addingVertexMode && isEditable() && interaction_r > 0) {
        // ... (Add vertex logic - unchanged) ...
        if (selectedShapeIndex !== -1 && shapes[selectedShapeIndex]) {
             let shape = shapes[selectedShapeIndex];
             if (!shape || !shape.vertexData) { console.error("Add Vertex Failed: Invalid shape", selectedShapeIndex); updateUIControls(); return; }
             let closestEdgeInfo = findClosestEdge(shape, mx_rel, my_rel, interaction_r);
             if (closestEdgeInfo && closestEdgeInfo.dist < edgeClickMinDist) {
                 let v1 = shape.vertexData[closestEdgeInfo.index]; let v2 = shape.vertexData[(closestEdgeInfo.index + 1) % shape.vertexData.length];
                 if (typeof v1?.x !== 'number' || typeof v1?.y !== 'number' || typeof v2?.x !== 'number' || typeof v2?.y !== 'number') { console.error("Add Vertex Failed: Invalid edge points", v1, v2); updateUIControls(); return; }
                 let newVertex = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 };
                 let insertionIndex = closestEdgeInfo.index + 1;
                 shape.vertexData.splice(insertionIndex, 0, newVertex);
                 selectedVertexIndices = []; draggingVertex = false;
             }
        }
        updateUIControls(); return; // Always return if in add mode
    }


    // --- 2. Vertex Handle Interaction (Multi-Select Aware) ---
    let clickedVertexHandleIndex = -1;
    if (isEditable() && selectedShapeIndex !== -1 && shapes[selectedShapeIndex] && interaction_r > 0) {
        // ... (Vertex handle finding logic - unchanged) ...
        let selectedShape = shapes[selectedShapeIndex];
         if (selectedShape && selectedShape.vertexData) {
              for (let i = 0; i < selectedShape.vertexData.length; i++) {
                  let v = selectedShape.vertexData[i];
                  if (typeof v?.x !== 'number' || typeof v?.y !== 'number') continue;
                  let screenX = v.x * interaction_r; let screenY = v.y * interaction_r;
                  let dSq = (mx_rel - screenX)**2 + (my_rel - screenY)**2;
                  if (dSq < grabRadius**2) { clickedVertexHandleIndex = i; break; }
              }
         }
    }

    if (clickedVertexHandleIndex !== -1) { // A handle was clicked
        // ... (Handle multi-select/drag initiation logic - unchanged) ...
        let indexInSelection = selectedVertexIndices.indexOf(clickedVertexHandleIndex);
        let currentlySelected = indexInSelection !== -1;
        if (keyIsDown(SHIFT)) { // Toggle Selection
             if (currentlySelected) { selectedVertexIndices.splice(indexInSelection, 1); }
             else { selectedVertexIndices.push(clickedVertexHandleIndex); }
        } else { // Normal Click
             if (!currentlySelected) { selectedVertexIndices = [clickedVertexHandleIndex]; }
             draggingVertex = true; dragVertexStartX = mx_rel; dragVertexStartY = my_rel;
             dragVertexInitialPositions = [];
             let shape = shapes[selectedShapeIndex];
             if (shape && shape.vertexData) { selectedVertexIndices.forEach(idx => { if (shape.vertexData[idx]) { dragVertexInitialPositions.push({ index: idx, x: shape.vertexData[idx].x, y: shape.vertexData[idx].y }); } }); }
             draggingShape = false;
        }
        updateUIControls(); return; // Interaction handled
    }
    draggingVertex = false; // No handle clicked

    // --- 3. Shape Selection / Shape Drag Initiation ---
    let clickedShapeIndex = -1;
    let clickedInsideSelectedShape = false;
    if (interaction_r > 0 || currentShipKey === '--- New Blank ---') {
        let check_r = interaction_r > 0 ? interaction_r : 1;
        // *** CHANGE: Loop from top shape (last drawn, index 0) downwards ***
        for (let i = 0; i < shapes.length; i++) {
             let currentShape = shapes[i];
             if (!currentShape || !currentShape.vertexData || currentShape.vertexData.length < 3) continue;
            let px_rel = mx_rel / check_r; let py_rel = my_rel / check_r;
            if (isPointInPolygon(px_rel, py_rel, currentShape.vertexData)) {
                 clickedShapeIndex = i; // Found the topmost shape containing the click
                 if (i === selectedShapeIndex) { clickedInsideSelectedShape = true; }
                 break; // Stop after finding the first (topmost) one
             }
        }
    }

    if (clickedShapeIndex !== -1) { // Click was inside *some* shape
        if (clickedInsideSelectedShape && isEditable()) {
             draggingShape = true; // Start shape drag
             dragShapeStartX = mouseX; dragShapeStartY = mouseY;
        } else if (selectedShapeIndex !== clickedShapeIndex) { // Select new shape
            selectedShapeIndex = clickedShapeIndex; selectedVertexIndices = []; draggingShape = false; updateColorPickersFromSelection();
        }
    } else { // Click was outside any shape
        if (selectedShapeIndex !== -1 && !isThargoidSelected()) { selectedShapeIndex = -1; selectedVertexIndices = []; }
        draggingShape = false;
    }
    updateUIControls();
}


// ** mouseDragged updated for Constrained Drag **
function mouseDragged() {
    // --- Calculate Scaled Radius ---
    let actualDrawSize_s = 0;
    if (currentShipDef) { actualDrawSize_s = (currentShipDef.size || 1) * pixelsPerUnit; }
    else if (shapes.length > 0 && currentShipKey === '--- New Blank ---') { actualDrawSize_s = 50 * pixelsPerUnit; }
    let interaction_r = actualDrawSize_s > 0 ? actualDrawSize_s / 2 : 1;

    // --- Handle Multi-Vertex Dragging ---
    if (draggingVertex && selectedShapeIndex !== -1 && selectedVertexIndices.length > 0) {
        let shape = shapes[selectedShapeIndex];
        if (shape && shape.vertexData) {
            let currentMxRel = mouseX - width / 2; let currentMyRel = mouseY - height / 2;
            let deltaScreenX = currentMxRel - dragVertexStartX; // Total delta from start in screen pixels
            let deltaScreenY = currentMyRel - dragVertexStartY;

            // --- Axis Constraint Logic for Vertices ---
            if (keyIsDown(SHIFT)) {
                if (dragConstrainedAxis === null) { // Determine axis on first significant move with Shift
                    if (abs(deltaScreenX) > 5 || abs(deltaScreenY) > 5) { // Threshold to lock axis
                        dragConstrainedAxis = abs(deltaScreenX) > abs(deltaScreenY) ? 'x' : 'y';
                    }
                }
                // Apply constraint
                if (dragConstrainedAxis === 'x') { deltaScreenY = 0; }
                else if (dragConstrainedAxis === 'y') { deltaScreenX = 0; }
            } else {
                dragConstrainedAxis = null; // Reset constraint if Shift released
            }
            // --- End Constraint Logic ---

            let deltaRelX = deltaScreenX / interaction_r; let deltaRelY = deltaScreenY / interaction_r;

            dragVertexInitialPositions.forEach(initialPos => {
                let vertexIndex = initialPos.index;
                if (shape.vertexData[vertexIndex]) {
                    shape.vertexData[vertexIndex].x = initialPos.x + deltaRelX;
                    shape.vertexData[vertexIndex].y = initialPos.y + deltaRelY;
                }
            });
        } else { draggingVertex = false; } // Stop if shape invalid
    }
    // --- Handle Shape Dragging ---
    else if (draggingShape && selectedShapeIndex !== -1 && shapes[selectedShapeIndex]) {
        let shape = shapes[selectedShapeIndex];
        if (shape && shape.vertexData) {
            let dx = mouseX - pmouseX; let dy = mouseY - pmouseY; // Delta for this frame

            // --- Axis Constraint Logic for Shape ---
            if (keyIsDown(SHIFT)) {
                 if (dragConstrainedAxis === null) { // Determine axis based on total drag from start
                     let totalDx = mouseX - dragShapeStartX; let totalDy = mouseY - dragShapeStartY;
                     if (abs(totalDx) > 5 || abs(totalDy) > 5) {
                         dragConstrainedAxis = abs(totalDx) > abs(totalDy) ? 'x' : 'y';
                     }
                 }
                 // Apply constraint to frame delta
                 if (dragConstrainedAxis === 'x') { dy = 0; }
                 else if (dragConstrainedAxis === 'y') { dx = 0; }
            } else {
                 dragConstrainedAxis = null; // Reset constraint
            }
            // --- End Constraint Logic ---

            let deltaRelX = dx / interaction_r; let deltaRelY = dy / interaction_r;
            for (let v of shape.vertexData) { if (typeof v?.x === 'number' && typeof v?.y === 'number') { v.x += deltaRelX; v.y += deltaRelY; } }
        } else { draggingShape = false; }
    }
}


// ** mouseReleased resets flags and constraint **
function mouseReleased() {
    if (draggingVertex) draggingVertex = false;
    if (draggingShape) draggingShape = false;
    dragVertexInitialPositions = []; // Clear initial positions on release
    dragConstrainedAxis = null; // Reset axis constraint
}


// ** keyPressed updated for Multi-Select **
function keyPressed() {
    if ((keyCode === DELETE || keyCode === BACKSPACE) && !keyIsDown(SHIFT) && selectedShapeIndex !== -1 && selectedVertexIndices.length > 0) { // Delete selected vertices
         if(shapes[selectedShapeIndex]?.vertexData){
            let shape = shapes[selectedShapeIndex];
            let remainingVertices = shape.vertexData.length - selectedVertexIndices.length;
            if (remainingVertices >= 3) {
                 shape.vertexData = shape.vertexData.filter((_, index) => !selectedVertexIndices.includes(index));
                 selectedVertexIndices = []; draggingVertex = false;
            } else { console.warn(`Cannot delete vertices - must leave at least 3.`); }
         }
    }
    else if ((keyCode === DELETE || keyCode === BACKSPACE) && keyIsDown(SHIFT) && selectedShapeIndex !== -1) { // Delete selected shape
         if (shapes.length > selectedShapeIndex && selectedShapeIndex >= 0) {
               shapes.splice(selectedShapeIndex, 1);
               selectedShapeIndex = -1; selectedVertexIndices = []; draggingVertex = false; draggingShape = false;
               updateUIControls();
         }
    }
}

// --- UI Update Functions ---
function updateUIControls() {
    let editable = isEditable();
    let shapeSelected = (currentShipKey === '--- New Blank ---' && shapes.length > 0) ||
                        (selectedShapeIndex !== -1 && editable && selectedShapeIndex < shapes.length && shapes[selectedShapeIndex]);

    if(addShapeButton?.elt) addShapeButton.elt.disabled = !editable && currentShipKey !== '--- New Blank ---';
    if(exportButton?.elt) exportButton.elt.disabled = false;

    const shouldBeDisabled = !shapeSelected;
    if(addVertexButton?.elt) addVertexButton.elt.disabled = shouldBeDisabled;
    if(fillColorPicker?.elt) fillColorPicker.elt.disabled = shouldBeDisabled;
    if(strokeColorPicker?.elt) strokeColorPicker.elt.disabled = shouldBeDisabled;
    if(strokeWeightInput?.elt) strokeWeightInput.elt.disabled = shouldBeDisabled;

    if (shouldBeDisabled && addingVertexMode) addingVertexMode = false;

    if(addVertexButton) {
        if (addingVertexMode && shapeSelected) { addVertexButton.addClass('active'); }
        else { addVertexButton.removeClass('active'); }
    }
    if (addingVertexMode && !shapeSelected) addingVertexMode = false;
}
function updateColorPickersFromSelection() {
     if (selectedShapeIndex !== -1 && selectedShapeIndex < shapes.length && shapes[selectedShapeIndex]) {
          let shape = shapes[selectedShapeIndex];
          if(shape.fillColor && shape.strokeColor && typeof shape.strokeW === 'number'){
              if(fillColorPicker) fillColorPicker.value(rgbToHex(shape.fillColor));
              if(strokeColorPicker) strokeColorPicker.value(rgbToHex(shape.strokeColor));
              if(strokeWeightInput) strokeWeightInput.value(shape.strokeW);
          }
     } else {
          // Optionally reset pickers if nothing is selected
          // if(fillColorPicker) fillColorPicker.value('#cccccc');
          // if(strokeColorPicker) strokeColorPicker.value('#333333');
          // if(strokeWeightInput) strokeWeightInput.value(1);
     }
}
function updateSelectedShapeFill() {
    if (selectedShapeIndex !== -1 && selectedShapeIndex < shapes.length && shapes[selectedShapeIndex]) {
        let col = color(fillColorPicker.value());
        shapes[selectedShapeIndex].fillColor = [red(col), green(col), blue(col)];
    }
}
function updateSelectedShapeStroke() {
     if (selectedShapeIndex !== -1 && selectedShapeIndex < shapes.length && shapes[selectedShapeIndex]) {
        let col = color(strokeColorPicker.value());
        shapes[selectedShapeIndex].strokeColor = [red(col), green(col), blue(col)];
    }
}
function updateSelectedShapeStrokeWeight() {
    if (selectedShapeIndex !== -1 && selectedShapeIndex < shapes.length && shapes[selectedShapeIndex]) {
        shapes[selectedShapeIndex].strokeW = parseFloat(strokeWeightInput.value()) || 0;
    }
}

// --- Action Functions ---
function addNewShape() {
    if (!isEditable() && currentShipKey !== '--- New Blank ---') return;
    let defaultShape = {
         vertexData: [ { x: -0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0, y: -0.2 } ],
         fillColor: [150, 150, 180], strokeColor: [50, 50, 60], strokeW: 1
    };
    shapes.unshift(defaultShape);
    selectedShapeIndex = 0; selectedVertexIndices = [];
    if (currentShipKey === null || currentShipKey === 'Select a Base...') {
         currentShipKey = '--- New Blank ---'; currentShipDef = null;
    }
    updateUIControls(); updateColorPickersFromSelection();
}
function toggleAddVertexMode() {
    if (selectedShapeIndex !== -1 && isEditable() && shapes[selectedShapeIndex]) {
        addingVertexMode = !addingVertexMode;
        if (addingVertexMode) { draggingVertex = false; selectedVertexIndices = []; draggingShape = false;}
         updateUIControls();
    } else {
        if (addingVertexMode) { addingVertexMode = false; updateUIControls(); }
    }
}
function exportDrawFunctionCode() {
    let baseName = 'CustomShip';
    if (currentShipDef && currentShipKey !== '--- New Blank---') {
        baseName = currentShipKey.replace(/\s+/g, '').replace('Mk', 'Mk');
    }
    let functionName = `draw${baseName}_Edited`;
    let code = [];
    code.push(`// --- Generated draw function for ${baseName} (Edited) ---`);
    code.push(`// --- Base Ship Size (for reference): ${currentShipDef ? currentShipDef.size : 'N/A (Custom)'} ---`);
    code.push(`// --- Contains ${shapes.length} shape layer(s) ---`);
    code.push(`function ${functionName}(s, thrusting = false) {`);
    code.push(`    let r = s / 2; // Calculate radius based on the desired draw size 's'`);
    code.push(``);

    shapes.forEach((shape, index) => {
        if (!shape || !shape.vertexData || shape.vertexData.length < 2) return;
        code.push(`    // --- Shape Layer ${index + 1} ---`);
        code.push(`    fill(${shape.fillColor ? shape.fillColor.join(', ') : '150, 150, 150'});`);
        code.push(`    stroke(${shape.strokeColor ? shape.strokeColor.join(', ') : '50, 50, 50'});`);
        code.push(`    strokeWeight(${typeof shape.strokeW === 'number' ? shape.strokeW : 1});`);
        code.push(`    beginShape();`);
        shape.vertexData.forEach(v => {
             if (typeof v?.x === 'number' && typeof v?.y === 'number') {
                 code.push(`    vertex(r * ${v.x.toFixed(3)}, r * ${v.y.toFixed(3)});`);
             }
        });
        code.push(`    endShape(CLOSE);`);
        code.push(``);
    });

    if (currentShipDef && currentShipKey !== '--- New Blank---') {
        try {
            let originalFuncStr = currentShipDef.drawFunction.toString();
            let engineGlowLines = originalFuncStr.match(/if\s*\(\s*thrusting\s*\)[\s\S]*?\}\s*?(?=\})/);
            if (engineGlowLines && engineGlowLines[0]) {
                code.push(`    // --- Engine glow (copied from original base: ${currentShipDef.name}) ---`);
                let glowCode = engineGlowLines[0].split('\n').map(line => '    ' + line.trim()).join('\n').trim();
                code.push(`    ${glowCode}`); code.push(``);
            } else { code.push(`    // --- Engine glow code not found in base function structure ---`); code.push(``); }
        } catch (e) { console.error("Error copying engine glow code:", e); code.push(`    // --- Error encountered trying to copy engine glow code ---`); code.push(``); }
    } else { code.push(`    // --- No engine glow defined for base (or custom ship) ---`); code.push(``); }

    code.push(`}`); code.push(`// --- End Generated Function ---`);
    saveStrings(code, `${functionName}.js`, 'js');
}

// --- Utility Functions ---
function isPointInPolygon(px, py, polygonVertices) {
    if (!polygonVertices || polygonVertices.length < 3) return false;
    let isInside = false;
    for (let i = 0, j = polygonVertices.length - 1; i < polygonVertices.length; j = i++) {
        let vi = polygonVertices[i]; let vj = polygonVertices[j];
         if (typeof vi?.x !== 'number' || typeof vi?.y !== 'number' || typeof vj?.x !== 'number' || typeof vj?.y !== 'number') continue;
        let xi = vi.x, yi = vi.y; let xj = vj.x, yj = vj.y;
        let intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) isInside = !isInside;
    } return isInside;
}
function findClosestEdge(shape, mx_rel, my_rel, r_scale) {
    let minDistSq = Infinity; let closestEdgeIndex = -1;
    if (!shape || !shape.vertexData || shape.vertexData.length < 2) return null;
    for (let i = 0; i < shape.vertexData.length; i++) {
        let v1 = shape.vertexData[i]; let v2 = shape.vertexData[(i + 1) % shape.vertexData.length];
         if (typeof v1?.x !== 'number' || typeof v1?.y !== 'number' || typeof v2?.x !== 'number' || typeof v2?.y !== 'number') continue;
        let x1 = v1.x * r_scale; let y1 = v1.y * r_scale; let x2 = v2.x * r_scale; let y2 = v2.y * r_scale;
        let distSq = distSqToSegment(mx_rel, my_rel, x1, y1, x2, y2);
        if (distSq < minDistSq) { minDistSq = distSq; closestEdgeIndex = i; }
    }
    if (closestEdgeIndex !== -1) { return { index: closestEdgeIndex, dist: sqrt(minDistSq) }; }
    return null;
}
function distSqToSegment(px, py, x1, y1, x2, y2) {
    let l2 = distSq(x1, y1, x2, y2); if (l2 === 0) return distSq(px, py, x1, y1);
    let t = (l2 > 1e-9) ? (((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2) : 0;
    t = Math.max(0, Math.min(1, t));
    let projX = x1 + t * (x2 - x1); let projY = y1 + t * (y2 - y1);
    return distSq(px, py, projX, projY);
}
function distSq(x1, y1, x2, y2) { let dx = x1 - x2; let dy = y1 - y2; return dx * dx + dy * dy; }
function rgbToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 3) return "#000000";
  try {
      return '#' + rgb.map(x => {
        let num = Number(x); if(isNaN(num)) num = 0;
        const hex = Math.round(constrain(num, 0, 255)).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      }).join('');
  } catch (e) { return "#000000"; }
}