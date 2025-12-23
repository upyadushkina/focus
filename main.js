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

// Automation states
let isTidyMode = false;
let isPrettyMode = false;
let isCoworkingMode = false;
let isWriteDownMode = false;
let isReversedListMode = false;
let currentVideoElement = null;

// Interface color schemes
const INITIAL_COLORS = {
  background: '#EC0376',
  edges: '#F3F805',
  textOnBackground: '#F3F805',
  buttonText: '#F3F805',
  text: '#02D754',
  buttonBg: '#EC0376'
};

const PRETTY_COLORS = {
  background: '#262123',
  edges: '#4C4646',
  textOnBackground: '#4C4646',
  buttonText: '#4C4646',
  text: '#E8DED3',
  buttonBg: '#322C2E'
};

let currentColors = INITIAL_COLORS;

// Initial node opacity
const INITIAL_OPACITY = 0.7;
const FULL_OPACITY = 1.0;

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
  const projectMap = new Map();
  
  // Build nodes array
  nodes = csvData
    .filter(row => row['technique name'] && row['technique name'].trim() !== '') // Filter out empty rows
    .map(row => {
    // Parse order_tag
    const orderTag = row['order_tag'] ? row['order_tag'].trim() : '';
    
    // Parse connected techniques
    const connectedTechniques = row['connected techniques']
      ? row['connected techniques'].split(',').map(p => p.trim()).filter(p => p.length > 0)
      : [];
    
    // Convert scale to number
    const scale = parseFloat(row.scale) || 1;
    
    // Get colors - if color is empty, use pretty_color as initial color
    let color = row.color ? row.color.trim() : '';
    const prettyColor = row['pretty_color'] ? row['pretty_color'].trim() : '';
    // If color is empty but pretty_color exists, use pretty_color as initial
    if (!color && prettyColor) {
      color = prettyColor;
    }
    // If both are empty, use default
    if (!color) {
      color = '#E673C8';
    }
    // If pretty_color is empty, use color
    const finalPrettyColor = prettyColor || color;
    
    // Create node object
    const node = {
      id: row['technique name'].trim(),
      name: row['technique name'].trim(),
      type: row.type ? row.type.trim() : '',
      orderTag: orderTag,
      color: color,
      prettyColor: finalPrettyColor,
      initialColor: color, // Store initial color for reversedList
      scale: scale,
      description: row.description || '',
      automationFunction: row['automation_function'] ? row['automation_function'].trim() : '',
      automationConfig: row['automation_config'] || '',
      videoUrl: row['video_url'] ? row['video_url'].trim() : '',
      connectedTechniques: connectedTechniques,
      isEmoji: false, // Track if node is currently emoji
      originalColor: color // For restoring after reversedList
    };
    
    projectMap.set(node.id, node);
    return node;
  });
  
  // Build links array
  links = [];
  const linkSet = new Set();
  
  nodes.forEach(node => {
    node.connectedTechniques.forEach(connectedName => {
      const targetNode = projectMap.get(connectedName);
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
 * Create X position scale based on order tags
 */
function createOrderTagScale(width, orderTags) {
  return d3.scalePoint()
    .domain(orderTags)
    .range([width * 0.1, width * 0.9])
    .padding(0.3);
}

/**
 * Get X position for a node based on its order tag
 */
function getNodeXPosition(node, orderTagScale) {
  if (!node.orderTag || node.orderTag === '') {
    return orderTagScale.range()[1] / 2;
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
 * Apply interface colors
 */
function applyInterfaceColors(colors) {
  currentColors = colors;
  document.documentElement.style.setProperty('--bg-color', colors.background);
  document.documentElement.style.setProperty('--text-color', colors.text);
  document.documentElement.style.setProperty('--link-color', colors.edges);
  document.documentElement.style.setProperty('--type-color', colors.textOnBackground);
  document.documentElement.style.setProperty('--button-text-color', colors.buttonText);
  document.documentElement.style.setProperty('--button-bg-color', colors.buttonBg);
  
  // Update SVG background
  if (svg) {
    svg.style('background-color', colors.background);
  }
  
  // Update link colors
  if (linkElements) {
    linkElements.attr('stroke', colors.edges);
  }
  
  // Update background columns
  if (backgroundColumns) {
    backgroundColumns.selectAll('text').attr('fill', colors.textOnBackground);
    backgroundColumns.selectAll('line').attr('stroke', colors.textOnBackground);
  }
  
  // Update node labels
  if (nodeGroups) {
    nodeGroups.selectAll('text.node-label').attr('fill', colors.text);
  }
}

/**
 * Initialize the visualization
 */
function initVisualization(data) {
  const container = d3.select('.content');
  const containerNode = container.node();
  const width = containerNode.clientWidth;
  const height = containerNode.clientHeight;
  
  // Apply initial colors
  applyInterfaceColors(INITIAL_COLORS);
  
  // Create SVG
  svg = d3.select('#visualization')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('background-color', currentColors.background);
  
  // Create main group for zoom/pan
  g = svg.append('g');
  
  // Create background columns group (initially hidden)
  backgroundColumns = g.append('g')
    .attr('class', 'background-columns')
    .style('display', 'none');
  
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
  
  // Draw links
  linkElements = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(data.links)
    .enter()
    .append('line')
    .attr('class', 'link')
    .attr('stroke', currentColors.edges)
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.6);
  
  // Create node groups
  nodeGroups = g.append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(data.nodes)
    .enter()
    .append('g')
    .attr('class', 'node-group')
    .attr('opacity', INITIAL_OPACITY) // Start at 70% opacity
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
    .attr('stroke', 'none');
  
  // Add labels to all nodes
  const phoneScale = getPhoneViewScale();
  const nodeLabels = nodeGroups.append('text')
    .attr('class', 'node-label')
    .text(d => d.name)
    .attr('font-size', 10 * phoneScale)
    .attr('text-anchor', 'middle')
    .attr('dy', d => getNodeRadius(d.scale) + 14 * phoneScale)
    .attr('fill', currentColors.text)
    .attr('pointer-events', 'none')
    .style('font-family', 'Lexend-Medium');
  
  // Update positions on simulation tick
  simulation.on('tick', () => {
    linkElements
      .attr('x1', d => {
        const source = typeof d.source === 'object' ? d.source : nodes.find(n => n.id === d.source);
        return source ? source.x : 0;
      })
      .attr('y1', d => {
        const source = typeof d.source === 'object' ? d.source : nodes.find(n => n.id === d.source);
        return source ? source.y : 0;
      })
      .attr('x2', d => {
        const target = typeof d.target === 'object' ? d.target : nodes.find(n => n.id === d.target);
        return target ? target.x : 0;
      })
      .attr('y2', d => {
        const target = typeof d.target === 'object' ? d.target : nodes.find(n => n.id === d.target);
        return target ? target.y : 0;
      });
    
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
  
  // Handle outside clicks
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
            el.classList.contains('popup-button')) {
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
        target.closest('text') ||
        target.closest('.top-btn') || 
        target.closest('#filters-popup') ||
        target.closest('#filters-backdrop') ||
        target.closest('#tips-popup') ||
        target.closest('#tips-backdrop')) {
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
    let opacity = isWriteDownMode ? FULL_OPACITY : INITIAL_OPACITY;
    if (n.id === d.id) {
      opacity = FULL_OPACITY;
    } else if (connectedIds.has(n.id)) {
      opacity = FULL_OPACITY;
    } else if (n.type === d.type) {
      opacity = FULL_OPACITY;
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
  
  nodeGroups.attr('opacity', n => nodeOpacityMap.get(n.id) || 1);
  
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
  clickedNode = d;
  
  // Check if node has automation function
  if (d.automationFunction && d.automationFunction.trim() !== '') {
    executeAutomation(d.automationFunction, d);
  }
  
  const connectedIds = new Set([d.id]);
  linkElements.each(function(l) {
    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
    if (sourceId === d.id) connectedIds.add(targetId);
    if (targetId === d.id) connectedIds.add(sourceId);
  });
  
  const nodeOpacityMap = new Map();
  nodeGroups.each(function(n) {
    let opacity = isWriteDownMode ? FULL_OPACITY : INITIAL_OPACITY;
    if (n.id === d.id) {
      opacity = FULL_OPACITY;
    } else if (connectedIds.has(n.id)) {
      opacity = FULL_OPACITY;
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
  
  nodeGroups.attr('opacity', n => nodeOpacityMap.get(n.id) || 1);
  
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
      playAnimation(node);
      break;
  }
}

/**
 * Tidy Up - Organize nodes by order_tag
 */
function tidyUp() {
  isTidyMode = true;
  
  // Get all unique order tags
  const orderTags = [...new Set(nodes.map(n => n.orderTag).filter(tag => tag && tag.trim() !== ''))].sort();
  
  if (orderTags.length === 0) return;
  
  const container = d3.select('.content').node();
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  // Create scale for order tags
  const orderTagScale = createOrderTagScale(width, orderTags);
  
  // Show background columns
  backgroundColumns.style('display', 'block');
  backgroundColumns.selectAll('*').remove();
  
  const columnWidth = width / orderTags.length;
  
  orderTags.forEach((tag, i) => {
    const x = i * columnWidth;
    const nextX = (i + 1) * columnWidth;
    const columnCenterX = x + columnWidth / 2;
    
    // Column rectangle
    backgroundColumns.append('rect')
      .attr('x', x)
      .attr('y', 0)
      .attr('width', columnWidth)
      .attr('height', height)
      .attr('fill', 'none')
      .attr('stroke', 'none');
    
    // Label
    const phoneScale = getPhoneViewScale();
    backgroundColumns.append('text')
      .attr('x', columnCenterX)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('fill', currentColors.textOnBackground)
      .attr('font-size', `${14 * phoneScale}px`)
      .attr('font-family', 'Lexend-Medium')
      .attr('pointer-events', 'none')
      .text(tag);
    
    // Separator
    if (i < orderTags.length - 1) {
      backgroundColumns.append('line')
        .attr('x1', nextX)
        .attr('y1', 0)
        .attr('x2', nextX)
        .attr('y2', height)
        .attr('stroke', currentColors.textOnBackground)
        .attr('stroke-width', 1 * phoneScale)
        .attr('stroke-opacity', 0.3)
        .attr('pointer-events', 'none');
    }
  });
  
  // Update force simulation to position nodes by order tag
  simulation.force('x', d3.forceX(d => getNodeXPosition(d, orderTagScale)).strength(0.8));
  simulation.force('y', d3.forceY(height / 2).strength(0.3));
  simulation.alpha(0.5).restart();
}

/**
 * Mess Up - Return to messy layout
 */
function messUp() {
  isTidyMode = false;
  
  // Hide background columns
  backgroundColumns.style('display', 'none');
  
  // Remove x force positioning
  simulation.force('x', null);
  simulation.force('y', d3.forceY(d3.select('.content').node().clientHeight / 2).strength(0.1));
  simulation.alpha(0.5).restart();
}

/**
 * Pretty It Up - Switch to pretty colors
 */
function prettyItUp() {
  isPrettyMode = true;
  applyInterfaceColors(PRETTY_COLORS);
  
  // Update all node colors to pretty colors
  nodeGroups.each(function(d) {
    const currentColor = isReversedListMode && d.orderTag && d.orderTag.includes('done') 
      ? '#03BA6D' 
      : d.prettyColor;
    d3.select(this).select('circle').attr('fill', currentColor);
  });
}

/**
 * Color Bombing - Return to initial colors
 */
function colorBombing() {
  isPrettyMode = false;
  applyInterfaceColors(INITIAL_COLORS);
  
  // Update all node colors to initial colors (respecting reversedList mode)
  nodeGroups.each(function(d) {
    const currentColor = isReversedListMode && d.orderTag && d.orderTag.includes('done')
      ? '#03BA6D'
      : d.color;
    d3.select(this).select('circle').attr('fill', currentColor);
  });
}

/**
 * Coworking - Transform circles to 👀 emoji
 */
function coworking() {
  isCoworkingMode = true;
  
  nodeGroups.each(function(d) {
    const group = d3.select(this);
    const radius = getNodeRadius(d.scale);
    
    // Remove circle
    group.select('circle').remove();
    
    // Add emoji text
    let emojiText = group.select('text.emoji');
    if (emojiText.empty()) {
      emojiText = group.append('text')
        .attr('class', 'emoji')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', radius * 2)
        .attr('pointer-events', 'none');
    }
    
    // Special case for "guilty" node
    if (d.name === 'guilty') {
      emojiText.text('🫠');
    } else {
      emojiText.text('👀');
    }
    
    d.isEmoji = true;
  });
}

/**
 * Run Away - Transform emoji back to circles
 */
function runAway() {
  isCoworkingMode = false;
  
  nodeGroups.each(function(d) {
    const group = d3.select(this);
    const radius = getNodeRadius(d.scale);
    
    // Remove emoji
    group.select('text.emoji').remove();
    
    // Add circle back
    let circle = group.select('circle');
    if (circle.empty()) {
      circle = group.insert('circle', ':first-child')
        .attr('class', 'node')
        .attr('r', radius)
        .attr('stroke', 'none');
    }
    
    // Set color (respecting current color mode)
    const currentColor = isReversedListMode && d.orderTag && d.orderTag.includes('done')
      ? '#03BA6D'
      : (isPrettyMode ? d.prettyColor : d.color);
    circle.attr('fill', currentColor);
    
    d.isEmoji = false;
  });
}

/**
 * Write Down - Increase opacity to 100%
 */
function writeDown() {
  isWriteDownMode = true;
  nodeGroups.attr('opacity', FULL_OPACITY);
}

/**
 * Keep It - Reduce opacity to 70%
 */
function keepIt() {
  isWriteDownMode = false;
  applyFilters(); // This will respect filter state but set base opacity to 70%
}

/**
 * Reversed List - Color nodes with "done" tag green
 */
function reversedList() {
  isReversedListMode = true;
  
  nodeGroups.each(function(d) {
    // Check if orderTag contains "done" (case insensitive)
    if (d.orderTag && d.orderTag.toLowerCase().includes('done')) {
      const group = d3.select(this);
      if (!d.isEmoji) {
        group.select('circle').attr('fill', '#03BA6D');
      }
      d.originalColor = d.color; // Store original color
      d.color = '#03BA6D';
    }
  });
}

/**
 * Ordinary List - Restore original colors
 */
function ordinaryList() {
  isReversedListMode = false;
  
  nodeGroups.each(function(d) {
    if (d.originalColor) {
      const group = d3.select(this);
      const restoreColor = isPrettyMode ? d.prettyColor : d.originalColor;
      if (!d.isEmoji) {
        group.select('circle').attr('fill', restoreColor);
      }
      d.color = d.originalColor;
      d.originalColor = null;
    }
  });
}

/**
 * Play Animation - Fullscreen video
 */
function playAnimation(node) {
  if (!node.videoUrl || node.videoUrl.trim() === '') return;
  
  // Convert YouTube URL to embed URL if needed
  let videoUrl = node.videoUrl;
  if (videoUrl.includes('youtu.be') || videoUrl.includes('youtube.com')) {
    let videoId = '';
    if (videoUrl.includes('youtu.be/')) {
      videoId = videoUrl.split('youtu.be/')[1].split('?')[0];
    } else if (videoUrl.includes('youtube.com/watch')) {
      videoId = videoUrl.split('v=')[1].split('&')[0];
    } else if (videoUrl.includes('youtube.com/embed')) {
      videoId = videoUrl.split('embed/')[1].split('?')[0];
    }
    if (videoId) {
      videoUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&modestbranding=1`;
    }
  }
  
  // Create fullscreen video container
  const videoContainer = document.createElement('div');
  videoContainer.id = 'fullscreen-video';
  videoContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: #000;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  
  let videoElement;
  if (videoUrl.includes('youtube.com/embed')) {
    // YouTube iframe
    videoElement = document.createElement('iframe');
    videoElement.src = videoUrl;
    videoElement.style.cssText = 'width: 100%; height: 100%; border: none;';
    videoElement.allow = 'autoplay; fullscreen';
  } else {
    // Regular video
    videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.controls = true;
    videoElement.autoplay = true;
    videoElement.style.cssText = 'max-width: 100%; max-height: 100%;';
  }
  
  videoContainer.appendChild(videoElement);
  document.body.appendChild(videoContainer);
  
  currentVideoElement = videoContainer;
  
  // Handle ESC key to close
  const handleEsc = (e) => {
    if (e.key === 'Escape' && currentVideoElement) {
      document.body.removeChild(currentVideoElement);
      currentVideoElement = null;
      document.removeEventListener('keydown', handleEsc);
    }
  };
  
  document.addEventListener('keydown', handleEsc);
  
  // Also allow clicking to close
  videoContainer.addEventListener('click', () => {
    if (currentVideoElement) {
      document.body.removeChild(currentVideoElement);
      currentVideoElement = null;
      document.removeEventListener('keydown', handleEsc);
    }
  });
}

/**
 * Show popup with node information
 */
function showPopup(node) {
  const popup = document.getElementById('popup');
  if (!popup) return;
  
  let html = '';
  
  // Node name
  html += `<div class="popup-name">${escapeHtml(node.name)}</div>`;
  
  // Type
  html += `<div class="popup-type">${escapeHtml(node.type)}</div>`;
  
  // Description
  if (node.description && node.description.trim() !== '') {
    html += `<div class="popup-description">${escapeHtml(node.description)}</div>`;
  }
  
  // Order tag (as clickable tag)
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
  const tagButtons = popup.querySelectorAll('.popup-tag');
  tagButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const orderTag = btn.getAttribute('data-order-tag');
      if (orderTag) {
        toggleOrderTagFilter(orderTag);
        const isActiveNow = selectedOrderTags.has(orderTag);
        btn.classList.toggle('active', isActiveNow);
      }
    });
  });
  
  updatePopupPosition(node);
}

/**
 * Update popup position
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
  
  Array.from(allOrderTags).sort().forEach(orderTag => {
    const tag = orderTagContainer.append('div')
      .attr('class', 'filter-tag')
      .text(orderTag)
      .classed('active', selectedOrderTags.has(orderTag))
      .attr('data-order-tag-filter', orderTag)
      .on('click', () => toggleOrderTagFilter(orderTag));
    
    orderTagFilterElements.set(orderTag, tag);
  });
}

/**
 * Toggle order tag filter
 */
function toggleOrderTagFilter(orderTag) {
  const shouldBecomeActive = !selectedOrderTags.has(orderTag);
  setOrderTagFilterState(orderTag, shouldBecomeActive);
}

/**
 * Set order tag filter state
 */
function setOrderTagFilterState(orderTag, shouldBeActive, options = {}) {
  const { apply = true } = options;
  const tag = orderTagFilterElements.get(orderTag);
  if (tag) {
    tag.classed('active', shouldBeActive);
  }
  if (shouldBeActive) {
    selectedOrderTags.add(orderTag);
  } else {
    selectedOrderTags.delete(orderTag);
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
  const baseOpacity = isWriteDownMode ? FULL_OPACITY : INITIAL_OPACITY;
  
  nodeGroups.each(function(d) {
    let opacity = baseOpacity;
    
    // Check type filter
    if (selectedTypes.size > 0 && !selectedTypes.has(d.type)) {
      opacity = 0.15;
    }
    // Check order tag filter
    else if (selectedOrderTags.size > 0) {
      if (!d.orderTag || !selectedOrderTags.has(d.orderTag)) {
        opacity = 0.15;
      }
    }
    // Check search query
    else if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      opacity = 0.15;
    }
    
    nodeOpacityMap.set(d.id, opacity);
  });
  
  nodeGroups.attr('opacity', d => nodeOpacityMap.get(d.id) || baseOpacity);
  
  linkElements.attr('stroke-opacity', l => {
    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
    const sourceOpacity = nodeOpacityMap.get(sourceId) || baseOpacity;
    const targetOpacity = nodeOpacityMap.get(targetId) || baseOpacity;
    return Math.min(sourceOpacity, targetOpacity);
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
    const text = await response.text();
    return text;
  } catch (error) {
    console.error('Error loading tips:', error);
    return '# Tips\n\nTips content could not be loaded.';
  }
}

/**
 * Convert markdown-like text to HTML
 */
function markdownToHtml(text) {
  // Simple markdown conversion
  let html = text;
  
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  
  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  
  return `<p>${html}</p>`;
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
  
  if (isTidyMode) {
    const orderTags = [...new Set(nodes.map(n => n.orderTag).filter(tag => tag && tag.trim() !== ''))].sort();
    if (orderTags.length > 0) {
      const orderTagScale = createOrderTagScale(width, orderTags);
      simulation.force('x', d3.forceX(d => getNodeXPosition(d, orderTagScale)).strength(0.8));
    }
  }
  
  simulation.force('center', d3.forceCenter(width / 2, height / 2));
  simulation.force('y', d3.forceY(height / 2).strength(0.1));
  
  // Update background columns if in tidy mode
  if (isTidyMode && backgroundColumns) {
    const orderTags = [...new Set(nodes.map(n => n.orderTag).filter(tag => tag && tag.trim() !== ''))].sort();
    if (orderTags.length > 0) {
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
          .attr('fill', currentColors.textOnBackground)
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
            .attr('stroke', currentColors.textOnBackground)
            .attr('stroke-width', 1 * phoneScale)
            .attr('stroke-opacity', 0.3)
            .attr('pointer-events', 'none');
        }
      });
    }
  }
  
  // Update node radii
  if (nodeGroups) {
    const phoneScale = getPhoneViewScale();
    nodeGroups.each(function(d) {
      const radius = getNodeRadius(d.scale);
      const group = d3.select(this);
      if (!d.isEmoji) {
        group.select('circle').attr('r', radius);
      } else {
        group.select('text.emoji').attr('font-size', radius * 2);
      }
      group.select('text.node-label')
        .attr('dy', radius + 14 * phoneScale)
        .attr('font-size', 10 * phoneScale);
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
  
  // Set up event listeners
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applyFilters();
  });
  
  document.getElementById('reset-filters').addEventListener('click', resetFilters);
  
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
  
  // Tips popup toggle
  const tipsBtn = document.getElementById('tips-btn');
  const tipsPopup = document.getElementById('tips-popup');
  const tipsBackdrop = document.getElementById('tips-backdrop');
  const closeTipsBtn = document.getElementById('close-tips');
  
  async function openTipsPopup() {
    const tipsContent = await loadTips();
    const tipsContentDiv = document.getElementById('tips-content');
    tipsContentDiv.innerHTML = markdownToHtml(tipsContent);
    tipsPopup.classList.add('active');
    tipsBackdrop.classList.add('active');
  }
  
  function closeTipsPopup() {
    tipsPopup.classList.remove('active');
    tipsBackdrop.classList.remove('active');
  }
  
  tipsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tipsPopup.classList.contains('active')) {
      closeTipsPopup();
    } else {
      openTipsPopup();
    }
  });
  
  closeTipsBtn.addEventListener('click', () => {
    closeTipsPopup();
  });
  
  tipsBackdrop.addEventListener('click', () => {
    closeTipsPopup();
  });
  
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

