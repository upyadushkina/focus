// Global state
let nodes = [];
let links = [];
let simulation = null;
let svg = null;
let g = null;
let nodeElements = null;
let nodeGroups = null;
let linkElements = null;
let backgroundColumns = null;
let selectedTypes = new Set();
let selectedOrderTags = new Set();
const orderTagFilterElements = new Map();
let searchQuery = '';
let clickedNode = null;
let hoveredNode = null;

// Automation state
let isTidyMode = false;
let isEisenhowerMode = false;
let isPrettyMode = false;
let isCoworkingMode = false;
let isWriteDownMode = false;
let isReversedListMode = false;
let nodeOriginalColors = new Map();
let nodeOriginalShapes = new Map();

// Initial interface colors (from GUIDE.md)
const INITIAL_COLORS = {
  background: '#EC0376',
  edges: '#F3F805',
  text: '#02D754',
  buttons: '#E673C8'
};

// Pretty interface colors (from GUIDE.md)
const PRETTY_COLORS = {
  background: '#262123',
  edges: '#4C4646',
  text: '#E8DED3',
  buttons: '#322C2E'
};

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Load and parse CSV data
 */
async function loadData() {
  try {
    const data = await d3.csv('Focus Database.csv');
    return normalizeData(data);
  } catch (error) {
    console.error('Error loading CSV:', error);
    return { nodes: [], links: [] };
  }
}

/**
 * Normalize CSV data into nodes and links
 */
function normalizeData(csvData) {
  const techniqueMap = new Map();
  
  // Build nodes array
  nodes = csvData
    .filter(row => row['technique name'] && row['technique name'].trim() !== '')
    .map(row => {
      // Parse connected techniques (comma-separated, trim whitespace)
      const connectedTechniques = row['connected techniques']
        ? row['connected techniques'].split(',').map(t => t.trim()).filter(t => t.length > 0)
        : [];
      
      // Convert scale to number
      const scale = parseFloat(row.scale) || 1;
      
      // Create node object
      const node = {
        id: row['technique name'],
        name: row['technique name'],
        type: row.type || '',
        tag: row.tag || '',
        matrixTag: row['matrix tag'] || '',
        color: row.color || '#E673C8',
        prettyColor: row.pretty_color || row.color || '#E673C8',
        orderTag: row.order_tag || '',
        scale: scale,
        description: row.description || '',
        automationFunction: row.automation_function || '',
        automationConfig: row.automation_config || '',
        videoUrl: row.video_url || '',
        connectedTechniques: connectedTechniques,
        fields: row.fields ? row.fields.split(',').map(f => f.trim()).filter(f => f.length > 0) : []
      };
      
      techniqueMap.set(node.id, node);
      return node;
    });
  
  // Build links array
  links = [];
  const linkSet = new Set();
  
  nodes.forEach(node => {
    node.connectedTechniques.forEach(connectedName => {
      const targetNode = techniqueMap.get(connectedName);
      if (targetNode && targetNode.id !== node.id) {
        const linkId = [node.id, targetNode.id].sort().join('|');
        if (!linkSet.has(linkId)) {
          linkSet.add(linkId);
          links.push({
            source: node.id,
            target: targetNode.id
          });
        }
      }
    });
  });
  
  return { nodes, links };
}

/**
 * Get all unique order tags
 */
function getAllOrderTags() {
  const tags = new Set();
  nodes.forEach(node => {
    if (node.orderTag && node.orderTag.trim() !== '') {
      tags.add(node.orderTag);
    }
  });
  return Array.from(tags).sort();
}

/**
 * Create X position scale based on order tags
 */
function createOrderTagScale(width, orderTags) {
  if (orderTags.length === 0) return null;
  return d3.scalePoint()
    .domain(orderTags)
    .range([width * 0.1, width * 0.9])
    .padding(0.5);
}

/**
 * Get X position for a node based on its order tag
 */
function getNodeXPosition(node, orderTagScale) {
  if (!orderTagScale || !node.orderTag || node.orderTag.trim() === '') {
    return orderTagScale ? orderTagScale.range()[1] / 2 : null;
  }
  return orderTagScale(node.orderTag) || orderTagScale.range()[1] / 2;
}

/**
 * Get phone view scale factor
 */
function getPhoneViewScale() {
  const isPhoneView = window.innerWidth <= 768;
  return isPhoneView ? 0.8 : 1.0;
}

/**
 * Calculate node radius based on scale value
 */
function getNodeRadius(scale) {
  const isPhoneView = window.innerWidth <= 768;
  const phoneScale = getPhoneViewScale();
  let radius;
  if (isPhoneView) {
    radius = 10 + scale * 2;
  } else {
    radius = 5 + scale * 3.7;
  }
  return radius * phoneScale;
}

/**
 * Initialize the visualization
 */
function initVisualization(data) {
  const container = d3.select('.content');
  const containerNode = container.node();
  const width = containerNode.clientWidth;
  const height = containerNode.clientHeight;
  
  // Create SVG
  svg = d3.select('#visualization')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);
  
  // Create main group for zoom/pan
  g = svg.append('g');
  
  // Create force simulation
  simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links)
      .id(d => d.id)
      .distance(100)
    )
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2));
  
  // Add zoom behavior
  const zoom = d3.zoom()
    .scaleExtent([0.3, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
  
  svg.call(zoom);
  
  // Create defs for clipPaths
  const defs = svg.append('defs');
  
  // Create background columns group (initially hidden)
  backgroundColumns = g.append('g')
    .attr('class', 'background-columns')
    .style('display', 'none');
  
  // Draw links
  linkElements = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(data.links)
    .enter()
    .append('line')
    .attr('class', 'link')
    .attr('stroke', INITIAL_COLORS.edges)
    .attr('stroke-width', 1.5);
  
  // Create node groups
  nodeGroups = g.append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(data.nodes)
    .enter()
    .append('g')
    .attr('class', 'node-group')
    .call(d3.drag()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded)
    )
    .on('mouseover', handleNodeHover)
    .on('mouseout', handleNodeMouseOut)
    .on('click', handleNodeClick);
  
  // Create circles for nodes
  nodeElements = nodeGroups.append('circle')
    .attr('class', 'node')
    .attr('r', d => getNodeRadius(d.scale))
    .attr('fill', d => d.color)
    .attr('stroke', 'none')
    .attr('opacity', 0.7);
  
  // Add labels (only for non-technique nodes)
  const phoneScale = getPhoneViewScale();
  const nodeLabels = nodeGroups.filter(d => d.type !== 'technique').append('text')
    .attr('class', 'node-label')
    .text(d => d.name)
    .attr('font-size', 10 * phoneScale)
    .attr('text-anchor', 'middle')
    .attr('dy', d => getNodeRadius(d.scale) + 14 * phoneScale)
    .attr('fill', INITIAL_COLORS.text)
    .attr('pointer-events', 'none')
    .style('font-family', 'Lexend-Medium');
  
  window.nodeLabels = nodeLabels;
  
  // Update positions on simulation tick
  simulation.on('tick', () => {
    linkElements
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    
    nodeGroups
      .attr('transform', d => `translate(${d.x},${d.y})`);
    
    const nodeToUpdate = clickedNode || hoveredNode;
    if (nodeToUpdate) {
      updatePopupPosition(nodeToUpdate);
    }
  });
  
  // Handle click on background to close popup
  svg.on('click', function(event) {
    const popup = document.getElementById('popup');
    if (popup && popup.style.display === 'block') {
      const path = event.composedPath ? event.composedPath() : (event.path || []);
      if (path.some(el => el === popup || (el && el.classList && el.classList.contains('popup')))) {
        return;
      }
    }
    
    if (event.target === svg.node() || event.target === g.node()) {
      clickedNode = null;
      hoveredNode = null;
      hidePopup();
    }
  });
  
  // Handle clicks/touches outside popup
  const handleOutsideClick = function(event) {
    const popup = document.getElementById('popup');
    if (!popup || popup.style.display !== 'block') return;
    
    const path = event.composedPath ? event.composedPath() : (event.path || []);
    
    for (let i = 0; i < path.length; i++) {
      const el = path[i];
      if (!el) continue;
      
      if (el === popup || el.id === 'popup') {
        return;
      }
      
      if (el.classList) {
        if (el.classList.contains('popup') || 
            el.classList.contains('popup-tag') || 
            el.classList.contains('popup-button') ||
            el.classList.contains('popup-name') ||
            el.classList.contains('popup-type') ||
            el.classList.contains('popup-description') ||
            el.classList.contains('popup-tags') ||
            el.classList.contains('popup-photo')) {
          return;
        }
      }
      
      if (el.nodeType === 1 && popup.contains(el)) {
        return;
      }
    }
    
    const target = event.target;
    
    if (popup.contains(target)) {
      return;
    }
    
    if (target.closest('.node-group') || 
        target.classList.contains('node') ||
        target.closest('circle') ||
        target.closest('text')) {
      return;
    }
    
    if (target.closest('.top-btn') || 
        target.closest('#filters-popup') ||
        target.closest('#filters-backdrop') ||
        target.closest('#tips-popup')) {
      return;
    }
    
    clickedNode = null;
    hoveredNode = null;
    hidePopup();
  };
  
  document.addEventListener('click', handleOutsideClick, true);
  document.addEventListener('touchend', function(e) {
    setTimeout(() => handleOutsideClick(e), 10);
  }, true);
}

/**
 * Drag handlers
 */
function dragStarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragEnded(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

/**
 * Handle node hover
 */
function handleNodeHover(event, d) {
  if (clickedNode && clickedNode.id !== d.id) {
    return;
  }
  
  hoveredNode = d;
  
  const connectedIds = new Set([d.id]);
  linkElements.each(function(l) {
    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
    if (sourceId === d.id) connectedIds.add(targetId);
    if (targetId === d.id) connectedIds.add(sourceId);
  });
  
  const nodeOpacityMap = new Map();
  nodeGroups.each(function(n) {
    let opacity = 1;
    if (n.id === d.id) {
      opacity = 1;
    } else if (connectedIds.has(n.id)) {
      opacity = 1;
    } else if (n.type === d.type) {
      opacity = 1;
    } else {
      opacity = 0.15;
    }
    nodeOpacityMap.set(n.id, opacity);
  });
  
  linkElements
    .classed('highlighted', l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return sourceId === d.id || targetId === d.id;
    })
    .attr('stroke-opacity', l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      const isConnected = sourceId === d.id || targetId === d.id;
      if (isConnected) {
        return 1;
      }
      const sourceOpacity = nodeOpacityMap.get(sourceId) || 1;
      const targetOpacity = nodeOpacityMap.get(targetId) || 1;
      return Math.min(sourceOpacity, targetOpacity);
    });
  
  nodeGroups.attr('opacity', n => {
    const baseOpacity = nodeOpacityMap.get(n.id) || 1;
    const currentOpacity = isWriteDownMode ? 1 : 0.7;
    return baseOpacity * currentOpacity;
  });
  
  if (!clickedNode || clickedNode.id === d.id) {
    showPopup(d);
  }
}

/**
 * Handle node mouse out
 */
function handleNodeMouseOut(event, d) {
  hoveredNode = null;
  
  if (clickedNode && clickedNode.id === d.id) {
    linkElements
      .classed('highlighted', false)
      .attr('stroke-opacity', 0.6);
    applyFilters();
    return;
  }
  
  linkElements
    .classed('highlighted', false)
    .attr('stroke-opacity', 0.6);
  
  applyFilters();
  
  if (!clickedNode) {
    hidePopup();
  }
}

/**
 * Handle node click
 */
function handleNodeClick(event, d) {
  event.stopPropagation();
  
  // Check if this is a control node with automation function
  if (d.automationFunction && d.automationFunction.trim() !== '') {
    executeAutomation(d.automationFunction, d);
    return;
  }
  
  clickedNode = d;
  
  const connectedIds = new Set([d.id]);
  linkElements.each(function(l) {
    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
    if (sourceId === d.id) connectedIds.add(targetId);
    if (targetId === d.id) connectedIds.add(sourceId);
  });
  
  const nodeOpacityMap = new Map();
  nodeGroups.each(function(n) {
    let opacity = 1;
    if (n.id === d.id) {
      opacity = 1;
    } else if (connectedIds.has(n.id)) {
      opacity = 1;
    } else {
      opacity = 0.15;
    }
    nodeOpacityMap.set(n.id, opacity);
  });
  
  linkElements
    .classed('highlighted', l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return sourceId === d.id || targetId === d.id;
    })
    .attr('stroke-opacity', l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      const isConnected = sourceId === d.id || targetId === d.id;
      if (isConnected) {
        return 1;
      }
      const sourceOpacity = nodeOpacityMap.get(sourceId) || 1;
      const targetOpacity = nodeOpacityMap.get(targetId) || 1;
      return Math.min(sourceOpacity, targetOpacity);
    });
  
  nodeGroups.attr('opacity', n => {
    const baseOpacity = nodeOpacityMap.get(n.id) || 1;
    const currentOpacity = isWriteDownMode ? 1 : 0.7;
    return baseOpacity * currentOpacity;
  });
  
  showPopup(d);
}

/**
 * Execute automation function
 */
function executeAutomation(functionName, node) {
  switch(functionName) {
    case 'tidyUp':
      tidyUp();
      break;
    case 'messUp':
      messUp();
      break;
    case 'prettyItUp':
      prettyItUp();
      break;
    case 'colorBombing':
      colorBombing();
      break;
    case 'coworking':
      coworking();
      break;
    case 'runAway':
      runAway();
      break;
    case 'writeDown':
      writeDown();
      break;
    case 'keepIt':
      keepIt();
      break;
    case 'reversedList':
      reversedList();
      break;
    case 'ordinaryList':
      ordinaryList();
      break;
    case 'animation':
      playAnimation(node.videoUrl);
      break;
    case 'pomodoro':
      pomodoro(node);
      break;
    case 'guilty':
      guilty(node);
      break;
    case 'eisenhowerMatrix':
      eisenhowerMatrix();
      break;
    default:
      console.warn('Unknown automation function:', functionName);
  }
}

/**
 * Tidy Up - Organize nodes by order_tag
 */
function tidyUp() {
  isTidyMode = true;
  isEisenhowerMode = false;
  
  const orderTags = getAllOrderTags();
  if (orderTags.length === 0) return;
  
  const container = d3.select('.content').node();
  const width = container.clientWidth;
  const orderTagScale = createOrderTagScale(width, orderTags);
  
  // Show background columns
  backgroundColumns.style('display', 'block');
  backgroundColumns.selectAll('*').remove();
  
  const columnWidth = width / orderTags.length;
  
  orderTags.forEach((tag, i) => {
    const x = i * columnWidth;
    const nextX = (i + 1) * columnWidth;
    const columnCenterX = x + columnWidth / 2;
    
    backgroundColumns.append('rect')
      .attr('x', x)
      .attr('y', 0)
      .attr('width', columnWidth)
      .attr('height', container.clientHeight)
      .attr('fill', 'none')
      .attr('stroke', 'none');
    
    const phoneScale = getPhoneViewScale();
    backgroundColumns.append('text')
      .attr('x', columnCenterX)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('fill', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
      .attr('font-size', `${14 * phoneScale}px`)
      .attr('font-family', 'Lexend-Medium')
      .attr('pointer-events', 'none')
      .text(tag);
    
    if (i < orderTags.length - 1) {
      backgroundColumns.append('line')
        .attr('x1', nextX)
        .attr('y1', 0)
        .attr('x2', nextX)
        .attr('y2', container.clientHeight)
        .attr('stroke', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
        .attr('stroke-width', 1 * phoneScale)
        .attr('stroke-opacity', 0.3)
        .attr('pointer-events', 'none');
    }
  });
  
  // Update force simulation to position nodes by order tag
  simulation.force('x', d3.forceX(d => {
    if (!d.orderTag || d.orderTag.trim() === '') {
      return width / 2;
    }
    return getNodeXPosition(d, orderTagScale);
  }).strength(0.8));
  
  simulation.force('y', d3.forceY(container.clientHeight / 2).strength(0.3));
  simulation.alpha(0.5).restart();
}

/**
 * Mess Up - Return to natural layout
 */
function messUp() {
  isTidyMode = false;
  isEisenhowerMode = false;
  
  // Hide background columns
  backgroundColumns.style('display', 'none');
  
  // Remove X force to allow natural positioning
  simulation.force('x', null);
  simulation.force('y', null);
  simulation.alpha(0.5).restart();
}

/**
 * Pretty It Up - Change all colors to pretty_color
 */
function prettyItUp() {
  isPrettyMode = true;
  
  // Store original colors if not already stored
  nodeGroups.each(function(d) {
    if (!nodeOriginalColors.has(d.id)) {
      nodeOriginalColors.set(d.id, d.color);
    }
    d.color = d.prettyColor;
  });
  
  // Update node colors
  nodeElements.attr('fill', d => d.prettyColor);
  
  // Update interface colors
  document.documentElement.style.setProperty('--bg-color', PRETTY_COLORS.background);
  document.documentElement.style.setProperty('--text-color', PRETTY_COLORS.text);
  document.documentElement.style.setProperty('--link-color', PRETTY_COLORS.edges);
  
  // Update link colors
  linkElements.attr('stroke', PRETTY_COLORS.edges);
  
  // Update label colors
  if (window.nodeLabels) {
    window.nodeLabels.attr('fill', PRETTY_COLORS.text);
  }
  
  // Update background columns if visible
  if (isTidyMode) {
    backgroundColumns.selectAll('text, line').attr('fill', PRETTY_COLORS.edges).attr('stroke', PRETTY_COLORS.edges);
  }
}

/**
 * Color Bombing - Return to initial colors
 */
function colorBombing() {
  isPrettyMode = false;
  
  // Restore original colors
  nodeGroups.each(function(d) {
    const originalColor = nodeOriginalColors.get(d.id) || d.color;
    d.color = originalColor;
  });
  
  // Update node colors
  nodeElements.attr('fill', d => {
    const originalColor = nodeOriginalColors.get(d.id) || d.color;
    return originalColor;
  });
  
  // Restore interface colors
  document.documentElement.style.setProperty('--bg-color', INITIAL_COLORS.background);
  document.documentElement.style.setProperty('--text-color', INITIAL_COLORS.text);
  document.documentElement.style.setProperty('--link-color', INITIAL_COLORS.edges);
  
  // Update link colors
  linkElements.attr('stroke', INITIAL_COLORS.edges);
  
  // Update label colors
  if (window.nodeLabels) {
    window.nodeLabels.attr('fill', INITIAL_COLORS.text);
  }
  
  // Update background columns if visible
  if (isTidyMode) {
    backgroundColumns.selectAll('text, line').attr('fill', INITIAL_COLORS.edges).attr('stroke', INITIAL_COLORS.edges);
  }
}

/**
 * Coworking - Transform all nodes to 👀 emoji
 */
function coworking() {
  isCoworkingMode = true;
  
  // Store original shapes
  nodeGroups.each(function(d) {
    if (!nodeOriginalShapes.has(d.id)) {
      nodeOriginalShapes.set(d.id, 'circle');
    }
  });
  
  // Replace circles with emoji text
  nodeElements.style('display', 'none');
  
  // Add emoji text if not already present
  nodeGroups.each(function() {
    const group = d3.select(this);
    if (group.select('text.emoji-node').empty()) {
      group.append('text')
        .attr('class', 'emoji-node')
        .text('👀')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', d => getNodeRadius(d.scale) * 2)
        .attr('pointer-events', 'none');
    }
  });
}

/**
 * Run Away - Transform emoji back to colored circles
 */
function runAway() {
  isCoworkingMode = false;
  
  // Show circles again
  nodeElements.style('display', 'block');
  
  // Remove all emoji text (👀, 🍅, 💘, etc.)
  nodeGroups.selectAll('text.emoji-node').remove();
  
  // Restore colors - use pretty color if pretty mode is active, otherwise original color
  nodeGroups.each(function(d) {
    let colorToUse;
    if (isPrettyMode) {
      // If pretty mode is active, use pretty color
      colorToUse = d.prettyColor;
      d.color = d.prettyColor;
    } else {
      // Otherwise restore original color
      const originalColor = nodeOriginalColors.get(d.id);
      if (originalColor) {
        colorToUse = originalColor;
        d.color = originalColor;
      } else {
        colorToUse = d.color;
      }
    }
    d3.select(this).select('circle').attr('fill', colorToUse);
  });
}

/**
 * Write Down - Increase opacity to 100%
 */
function writeDown() {
  isWriteDownMode = true;
  nodeElements.attr('opacity', 1);
  if (window.nodeLabels) {
    window.nodeLabels.attr('opacity', 1);
  }
}

/**
 * Keep It - Reduce opacity to 70%
 */
function keepIt() {
  isWriteDownMode = false;
  nodeElements.attr('opacity', 0.7);
  if (window.nodeLabels) {
    window.nodeLabels.attr('opacity', 0.7);
  }
  applyFilters();
}

/**
 * Reversed List - Recolor nodes with "done" tag to #03BA6D
 */
function reversedList() {
  isReversedListMode = true;
  
  nodeGroups.each(function(d) {
    // Check if node has "done" in the tag column
    const hasDone = d.tag && d.tag.toLowerCase().trim() === 'done';
    if (hasDone) {
      // Store original color if not already stored
      if (!nodeOriginalColors.has(d.id)) {
        nodeOriginalColors.set(d.id, d.color);
      }
      // Change to green
      d.color = '#03BA6D';
      d3.select(this).select('circle').attr('fill', '#03BA6D');
    }
  });
}

/**
 * Ordinary List - Restore original colors
 */
function ordinaryList() {
  isReversedListMode = false;
  
  nodeGroups.each(function(d) {
    const originalColor = nodeOriginalColors.get(d.id);
    if (originalColor) {
      d.color = originalColor;
      d3.select(this).select('circle').attr('fill', originalColor);
    }
  });
}

/**
 * Pomodoro - Transform all nodes to 🍅 emoji
 */
function pomodoro(node) {
  isCoworkingMode = true;
  
  // Store original shapes
  nodeGroups.each(function(d) {
    if (!nodeOriginalShapes.has(d.id)) {
      nodeOriginalShapes.set(d.id, 'circle');
    }
  });
  
  // Replace circles with emoji text
  nodeElements.style('display', 'none');
  
  // Add emoji text if not already present
  nodeGroups.each(function() {
    const group = d3.select(this);
    if (group.select('text.emoji-node').empty()) {
      group.append('text')
        .attr('class', 'emoji-node')
        .text('🍅')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', d => getNodeRadius(d.scale) * 2)
        .attr('pointer-events', 'none');
    }
  });
}

/**
 * Guilty - Transform all nodes to 💘 emoji, and the guilty node itself to 🫠
 */
function guilty(node) {
  isCoworkingMode = true;
  
  // Store original shapes
  nodeGroups.each(function(d) {
    if (!nodeOriginalShapes.has(d.id)) {
      nodeOriginalShapes.set(d.id, 'circle');
    }
  });
  
  // Replace circles with emoji text
  nodeElements.style('display', 'none');
  
  // Add emoji text
  nodeGroups.each(function(d) {
    const group = d3.select(this);
    if (group.select('text.emoji-node').empty()) {
      const emoji = (d.id === node.id) ? '🫠' : '💘';
      group.append('text')
        .attr('class', 'emoji-node')
        .text(emoji)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', d => getNodeRadius(d.scale) * 2)
        .attr('pointer-events', 'none');
    }
  });
}

/**
 * Eisenhower Matrix - Create 2x2 matrix and place nodes based on matrix tag
 */
function eisenhowerMatrix() {
  isTidyMode = true;
  isEisenhowerMode = true;
  
  const container = d3.select('.content').node();
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  // Show background matrix
  backgroundColumns.style('display', 'block');
  backgroundColumns.selectAll('*').remove();
  
  // Matrix structure: 2 columns (urgent, not urgent) x 2 rows (important, not important)
  const columnWidth = width / 2;
  const rowHeight = height / 2;
  
  const matrixLabels = [
    { x: columnWidth / 2, y: 0, text: 'Important\nUrgent' },
    { x: columnWidth * 1.5, y: 0, text: 'Not Important\nUrgent' },
    { x: columnWidth / 2, y: rowHeight, text: 'Important\nNot Urgent' },
    { x: columnWidth * 1.5, y: rowHeight, text: 'Not Important\nNot Urgent' }
  ];
  
  // Create matrix cells
  matrixLabels.forEach((label, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col * columnWidth;
    const y = row * rowHeight;
    
    // Background rectangle
    backgroundColumns.append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', columnWidth)
      .attr('height', rowHeight)
      .attr('fill', 'none')
      .attr('stroke', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.3);
    
    // Label at the top of each sector
    const phoneScale = getPhoneViewScale();
    const lines = label.text.split('\n');
    lines.forEach((line, lineIndex) => {
      backgroundColumns.append('text')
        .attr('x', label.x)
        .attr('y', label.y + 20 + (lineIndex * 20 * phoneScale))
        .attr('text-anchor', 'middle')
        .attr('fill', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
        .attr('font-size', `${14 * phoneScale}px`)
        .attr('font-family', 'Lexend-Medium')
        .attr('pointer-events', 'none')
        .text(line);
    });
  });
  
  // Vertical separator
  backgroundColumns.append('line')
    .attr('x1', columnWidth)
    .attr('y1', 0)
    .attr('x2', columnWidth)
    .attr('y2', height)
    .attr('stroke', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.3)
    .attr('pointer-events', 'none');
  
  // Horizontal separator
  backgroundColumns.append('line')
    .attr('x1', 0)
    .attr('y1', rowHeight)
    .attr('x2', width)
    .attr('y2', rowHeight)
    .attr('stroke', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.3)
    .attr('pointer-events', 'none');
  
  // Position nodes based on matrix tag
  simulation.force('x', d3.forceX(d => {
    if (!d.matrixTag || d.matrixTag.trim() === '') {
      return width / 2;
    }
    const tag = d.matrixTag.toLowerCase();
    // Check for urgent/not urgent
    if (tag.includes('urgent') && !tag.includes('not urgent')) {
      return columnWidth / 2; // Left column (urgent)
    } else if (tag.includes('not urgent')) {
      return columnWidth * 1.5; // Right column (not urgent)
    } else {
      return width / 2; // Default center
    }
  }).strength(0.8));
  
  simulation.force('y', d3.forceY(d => {
    if (!d.matrixTag || d.matrixTag.trim() === '') {
      return height / 2;
    }
    const tag = d.matrixTag.toLowerCase();
    // Check for important/not important
    if (tag.includes('important') && !tag.includes('not important')) {
      return rowHeight / 2; // Top row (important)
    } else if (tag.includes('not important')) {
      return rowHeight * 1.5; // Bottom row (not important)
    } else {
      return height / 2; // Default center
    }
  }).strength(0.8));
  
  simulation.alpha(0.5).restart();
}

/**
 * Play animation video in fullscreen
 */
function playAnimation(videoUrl) {
  if (!videoUrl || videoUrl.trim() === '') {
    console.warn('No video URL provided');
    return;
  }
  
  // Convert Google Drive link to direct video URL if needed
  let directVideoUrl = videoUrl;
  if (videoUrl.includes('drive.google.com') && videoUrl.includes('/d/')) {
    const parts = videoUrl.split('/d/');
    if (parts.length > 1) {
      const fileId = parts[1].split('/')[0].split('?')[0];
      directVideoUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
  }
  
  const videoContainer = document.getElementById('video-container');
  const video = document.getElementById('fullscreen-video');
  
  video.src = directVideoUrl;
  videoContainer.style.display = 'flex';
  video.play().catch(err => {
    console.error('Error playing video:', err);
  });
  
  // Close on ESC key
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      closeVideo();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
}

/**
 * Close video fullscreen
 */
function closeVideo() {
  const videoContainer = document.getElementById('video-container');
  const video = document.getElementById('fullscreen-video');
  
  video.pause();
  video.src = '';
  videoContainer.style.display = 'none';
}

/**
 * Show popup with technique information
 */
function showPopup(node) {
  const popup = document.getElementById('popup');
  if (!popup) return;
  
  let html = '';
  
  // Technique name
  html += `<div class="popup-name">${escapeHtml(node.name)}</div>`;
  
  // Type
  if (node.type) {
    html += `<div class="popup-type">${escapeHtml(node.type)}</div>`;
  }
  
  // Description
  if (node.description && node.description.trim() !== '') {
    html += `<div class="popup-description">${escapeHtml(node.description)}</div>`;
  }
  
  // Order tag
  if (node.orderTag && node.orderTag.trim() !== '') {
    html += `<div class="popup-tags">`;
    const safeTag = escapeHtml(node.orderTag);
    const isActiveTag = selectedOrderTags.has(node.orderTag);
    const activeClass = isActiveTag ? ' active' : '';
    html += `<button type="button" class="popup-tag${activeClass}" data-order-tag="${safeTag}">${safeTag}</button>`;
    html += `</div>`;
  }
  
  popup.innerHTML = html;
  popup.style.display = 'block';
  
  // Handle tag clicks
  const popupTags = popup.querySelectorAll('.popup-tag');
  popupTags.forEach(tag => {
    tag.addEventListener('click', (e) => {
      e.stopPropagation();
      const orderTag = tag.getAttribute('data-order-tag');
      if (orderTag) {
        toggleOrderTagFilter(orderTag);
        const isActiveNow = selectedOrderTags.has(orderTag);
        tag.classList.toggle('active', isActiveNow);
      }
    });
  });
  
  updatePopupPosition(node);
}

/**
 * Update popup position based on node location
 */
function updatePopupPosition(node) {
  const popup = document.getElementById('popup');
  if (!popup || !svg || popup.style.display !== 'block') return;
  
  const transform = d3.zoomTransform(svg.node());
  const x = node.x * transform.k + transform.x;
  const y = node.y * transform.k + transform.y;
  
  popup.style.left = (x + 15) + 'px';
  popup.style.top = (y + 15) + 'px';
}

/**
 * Hide popup
 */
function hidePopup() {
  const popup = document.getElementById('popup');
  if (popup) {
    popup.style.display = 'none';
  }
}

/**
 * Build filter UI
 */
function buildFilters() {
  const allTypes = new Set();
  const allOrderTags = new Set();
  
  nodes.forEach(node => {
    if (node.type) allTypes.add(node.type);
    if (node.orderTag && node.orderTag.trim() !== '') {
      allOrderTags.add(node.orderTag);
    }
  });
  
  // Build type filters
  const typeContainer = d3.select('#type-filters');
  typeContainer.selectAll('*').remove();
  
  Array.from(allTypes).sort().forEach(type => {
    const tag = typeContainer.append('div')
      .attr('class', 'filter-tag')
      .text(type)
      .on('click', function() {
        const isActive = d3.select(this).classed('active');
        d3.select(this).classed('active', !isActive);
        
        if (isActive) {
          selectedTypes.delete(type);
        } else {
          selectedTypes.add(type);
        }
        
        applyFilters();
      });
  });
  
  // Build order tag filters
  const orderTagContainer = d3.select('#order-tag-filters');
  orderTagContainer.selectAll('*').remove();
  orderTagFilterElements.clear();
  
  Array.from(allOrderTags).sort().forEach(tag => {
    const filterTag = orderTagContainer.append('div')
      .attr('class', 'filter-tag')
      .text(tag)
      .classed('active', selectedOrderTags.has(tag))
      .attr('data-order-tag-filter', tag)
      .on('click', () => toggleOrderTagFilter(tag));
    
    orderTagFilterElements.set(tag, filterTag);
  });
}

/**
 * Toggle order tag filter
 */
function toggleOrderTagFilter(tag) {
  const shouldBecomeActive = !selectedOrderTags.has(tag);
  setOrderTagFilterState(tag, shouldBecomeActive);
}

/**
 * Set order tag filter state
 */
function setOrderTagFilterState(tag, shouldBeActive, options = {}) {
  const { apply = true } = options;
  const filterTag = orderTagFilterElements.get(tag);
  if (filterTag) {
    filterTag.classed('active', shouldBeActive);
  }
  if (shouldBeActive) {
    selectedOrderTags.add(tag);
  } else {
    selectedOrderTags.delete(tag);
  }
  if (apply) {
    applyFilters();
  }
}

/**
 * Apply filters to nodes
 */
function applyFilters() {
  if (!nodeGroups || !linkElements) return;
  
  const nodeOpacityMap = new Map();
  nodeGroups.each(function(d) {
    let opacity = 1;
    
    if (selectedTypes.size > 0 && !selectedTypes.has(d.type)) {
      opacity = 0.15;
    }
    else if (selectedOrderTags.size > 0) {
      const hasMatchingTag = d.orderTag && selectedOrderTags.has(d.orderTag);
      if (!hasMatchingTag) {
        opacity = 0.15;
      }
    }
    else if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      opacity = 0.15;
    }
    
    nodeOpacityMap.set(d.id, opacity);
  });
  
  const baseOpacity = isWriteDownMode ? 1 : 0.7;
  nodeGroups.attr('opacity', d => {
    const filterOpacity = nodeOpacityMap.get(d.id) || 1;
    return filterOpacity * baseOpacity;
  });
  
  linkElements.attr('stroke-opacity', l => {
    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
    const sourceOpacity = nodeOpacityMap.get(sourceId) || 1;
    const targetOpacity = nodeOpacityMap.get(targetId) || 1;
    return Math.min(sourceOpacity, targetOpacity) * 0.6;
  });
}

/**
 * Reset all filters
 */
function resetFilters() {
  selectedTypes.clear();
  selectedOrderTags.clear();
  searchQuery = '';
  
  d3.selectAll('.filter-tag').classed('active', false);
  d3.select('#search-input').property('value', '');
  
  applyFilters();
}

/**
 * Load tips content
 */
async function loadTips() {
  try {
    const response = await fetch('tips.txt');
    if (response.ok) {
      const text = await response.text();
      document.getElementById('tips-content').innerHTML = text.split('\n').map(line => 
        line.trim() ? `<p>${escapeHtml(line)}</p>` : '<br>'
      ).join('');
    } else {
      document.getElementById('tips-content').innerHTML = '<p>Tips content not available.</p>';
    }
  } catch (error) {
    console.error('Error loading tips:', error);
    document.getElementById('tips-content').innerHTML = '<p>Tips content not available.</p>';
  }
}

/**
 * Handle window resize
 */
function handleResize() {
  if (!svg || !simulation) return;
  
  const container = d3.select('.content').node();
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  svg.attr('width', width).attr('height', height);
  
  if (isEisenhowerMode) {
    // Update eisenhower matrix forces
    const columnWidth = width / 2;
    const rowHeight = height / 2;
    
    simulation.force('x', d3.forceX(d => {
      if (!d.matrixTag || d.matrixTag.trim() === '') {
        return width / 2;
      }
      const tag = d.matrixTag.toLowerCase();
      if (tag.includes('urgent') && !tag.includes('not urgent')) {
        return columnWidth / 2;
      } else if (tag.includes('not urgent')) {
        return columnWidth * 1.5;
      } else {
        return width / 2;
      }
    }).strength(0.8));
    
    simulation.force('y', d3.forceY(d => {
      if (!d.matrixTag || d.matrixTag.trim() === '') {
        return height / 2;
      }
      const tag = d.matrixTag.toLowerCase();
      if (tag.includes('important') && !tag.includes('not important')) {
        return rowHeight / 2;
      } else if (tag.includes('not important')) {
        return rowHeight * 1.5;
      } else {
        return height / 2;
      }
    }).strength(0.8));
    
    // Redraw matrix
    if (backgroundColumns) {
      backgroundColumns.selectAll('*').remove();
      const matrixLabels = [
        { x: columnWidth / 2, y: 0, text: 'Important\nUrgent' },
        { x: columnWidth * 1.5, y: 0, text: 'Not Important\nUrgent' },
        { x: columnWidth / 2, y: rowHeight, text: 'Important\nNot Urgent' },
        { x: columnWidth * 1.5, y: rowHeight, text: 'Not Important\nNot Urgent' }
      ];
      
      matrixLabels.forEach((label, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = col * columnWidth;
        const y = row * rowHeight;
        
        backgroundColumns.append('rect')
          .attr('x', x)
          .attr('y', y)
          .attr('width', columnWidth)
          .attr('height', rowHeight)
          .attr('fill', 'none')
          .attr('stroke', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.3);
        
        // Label at the top of each sector
        const phoneScale = getPhoneViewScale();
        const lines = label.text.split('\n');
        lines.forEach((line, lineIndex) => {
          backgroundColumns.append('text')
            .attr('x', label.x)
            .attr('y', label.y + 20 + (lineIndex * 20 * phoneScale))
            .attr('text-anchor', 'middle')
            .attr('fill', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
            .attr('font-size', `${14 * phoneScale}px`)
            .attr('font-family', 'Lexend-Medium')
            .attr('pointer-events', 'none')
            .text(line);
        });
      });
      
      backgroundColumns.append('line')
        .attr('x1', columnWidth)
        .attr('y1', 0)
        .attr('x2', columnWidth)
        .attr('y2', height)
        .attr('stroke', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.3)
        .attr('pointer-events', 'none');
      
      backgroundColumns.append('line')
        .attr('x1', 0)
        .attr('y1', rowHeight)
        .attr('x2', width)
        .attr('y2', rowHeight)
        .attr('stroke', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.3)
        .attr('pointer-events', 'none');
    }
  } else if (isTidyMode) {
    const orderTags = getAllOrderTags();
    if (orderTags.length > 0) {
      const orderTagScale = createOrderTagScale(width, orderTags);
      simulation.force('x', d3.forceX(d => {
        if (!d.orderTag || d.orderTag.trim() === '') {
          return width / 2;
        }
        return getNodeXPosition(d, orderTagScale);
      }).strength(0.8));
    }
    
    if (backgroundColumns) {
      backgroundColumns.selectAll('*').remove();
      const columnWidth = width / orderTags.length;
      orderTags.forEach((tag, i) => {
        const x = i * columnWidth;
        const nextX = (i + 1) * columnWidth;
        const columnCenterX = x + columnWidth / 2;
        
        backgroundColumns.append('rect')
          .attr('x', x)
          .attr('y', 0)
          .attr('width', columnWidth)
          .attr('height', height)
          .attr('fill', 'none')
          .attr('stroke', 'none');
        
        const phoneScale = getPhoneViewScale();
        backgroundColumns.append('text')
          .attr('x', columnCenterX)
          .attr('y', 20)
          .attr('text-anchor', 'middle')
          .attr('fill', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
          .attr('font-size', `${14 * phoneScale}px`)
          .attr('font-family', 'Lexend-Medium')
          .attr('pointer-events', 'none')
          .text(tag);
        
        if (i < orderTags.length - 1) {
          backgroundColumns.append('line')
            .attr('x1', nextX)
            .attr('y1', 0)
            .attr('x2', nextX)
            .attr('y2', height)
            .attr('stroke', isPrettyMode ? PRETTY_COLORS.edges : INITIAL_COLORS.edges)
            .attr('stroke-width', 1 * phoneScale)
            .attr('stroke-opacity', 0.3)
            .attr('pointer-events', 'none');
        }
      });
    }
  }
  
  simulation.force('center', d3.forceCenter(width / 2, height / 2));
  
  if (nodeGroups) {
    const phoneScale = getPhoneViewScale();
    nodeGroups.each(function(d) {
      const radius = getNodeRadius(d.scale);
      const group = d3.select(this);
      group.select('circle').attr('r', radius);
      group.select('text.node-label')
        .attr('dy', radius + 14 * phoneScale)
        .attr('font-size', 10 * phoneScale);
      group.select('text.emoji-node')
        .attr('font-size', radius * 2);
    });
  }
  
  simulation.alpha(0.3).restart();
}

/**
 * Initialize the application
 */
async function init() {
  // Load data
  const data = await loadData();
  
  if (data.nodes.length === 0) {
    console.error('No data loaded');
    return;
  }
  
  // Initialize visualization
  initVisualization(data);
  
  // Build filters
  buildFilters();
  
  // Load tips
  loadTips();
  
  // Set up event listeners
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applyFilters();
  });
  
  document.getElementById('reset-filters').addEventListener('click', resetFilters);
  
  // Tips popup toggle
  const tipsBtn = document.getElementById('tips-btn');
  const tipsPopup = document.getElementById('tips-popup');
  const closeTipsBtn = document.getElementById('close-tips');
  
  function toggleTipsPopup() {
    tipsPopup.classList.toggle('active');
  }
  
  tipsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTipsPopup();
  });
  
  closeTipsBtn.addEventListener('click', () => {
    tipsPopup.classList.remove('active');
  });
  
  // Filters popup toggle
  const filtersBtn = document.getElementById('filters-btn');
  const filtersPopup = document.getElementById('filters-popup');
  const filtersBackdrop = document.getElementById('filters-backdrop');
  const closeFiltersBtn = document.getElementById('close-filters');
  
  function openFiltersPopup() {
    filtersPopup.classList.add('active');
    filtersBackdrop.classList.add('active');
  }
  
  function closeFiltersPopup() {
    filtersPopup.classList.remove('active');
    filtersBackdrop.classList.remove('active');
  }
  
  filtersBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openFiltersPopup();
  });
  
  closeFiltersBtn.addEventListener('click', () => {
    closeFiltersPopup();
  });
  
  filtersBackdrop.addEventListener('click', () => {
    closeFiltersPopup();
  });
  
  document.addEventListener('click', (e) => {
    if (filtersPopup.classList.contains('active') && 
        !filtersPopup.contains(e.target) && 
        e.target !== filtersBtn &&
        !filtersBackdrop.contains(e.target)) {
      closeFiltersPopup();
    }
  });
  
  // Video close button
  document.getElementById('close-video').addEventListener('click', closeVideo);
  
  // Fullscreen toggle
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error('Error attempting to enable fullscreen:', err);
      });
      fullscreenBtn.textContent = 'exit full screen';
    } else {
      document.exitFullscreen();
      fullscreenBtn.textContent = 'full screen';
    }
  });
  
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      fullscreenBtn.textContent = 'full screen';
    }
  });
  
  // Handle window resize
  window.addEventListener('resize', handleResize);
  
  // Update popup position on zoom/pan
  if (svg) {
    svg.on('zoom', () => {
      if (clickedNode) {
        updatePopupPosition(clickedNode);
      }
    });
  }
}

// Start the application
init();

