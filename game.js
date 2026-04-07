/**
 * ============================================================
 *  EconPlanTowerTycoon — game.js
 *  Full Backend Engine — Phase 2
 * ============================================================
 *
 *  Architecture:
 *    DATA        — Static definitions (generators, techs, etc.)
 *    STATE       — Mutable game state + schema versioning
 *    MATH        — Pure calculation functions (no side effects)
 *    ACTIONS     — State mutations (buy, research, prestige...)
 *    EVENTS      — Observer bus for UI / map / tower hooks
 *    SAVE        — Serialization, versioning, offline progress
 *    TICK        — Main game loop
 *    INIT        — Bootstrap
 *    API         — Public interface exposed as window.EPTT
 *
 * ============================================================
 */

'use strict';

(function (global) {

  // ===========================================================
  //  CONSTANTS
  // ===========================================================

  const SAVE_KEY       = 'eptt_v3_save';
  const SAVE_INTERVAL  = 30_000;   // ms
  const TICK_INTERVAL  = 100;      // ms
  const OFFLINE_CAP    = 8 * 3600; // seconds; max offline credit
  const SCHEMA_VERSION = 3;

  // Cost scaling base (1.12 is the sweet spot per Idle Math Part I)
  const COST_MULT_DEFAULT = 1.12;

  // ===========================================================
  //  DATA — GENERATORS
  //
  //  Each generator has:
  //    id, name, icon, tier, tierColor
  //    baseCost   — cost to buy the very first one
  //    costMult   — geometric series ratio (r)
  //    baseProd   — GDP/s per unit owned
  //    unlockGDP  — totalGDP needed before this gen is visible
  //    category   — 'resource' | 'goods' | 'industry' | 'advanced' | 'cyber'
  //    inputs     — (future) list of resource IDs consumed per second
  //    mapSprite  — (future) sprite key for map view
  // ===========================================================

  const GENERATORS = [
    // ---- RESOURCES ----
    {
      id: 'coal_mine',       name: 'Coal Mine',          icon: '⛏️',
      tier: 'Resources',     tierColor: '#a0522d',
      category: 'resource',
      baseCost: 10,          costMult: 1.12,   baseProd: 0.5,
      unlockGDP: 0,
      desc: 'Surface coal extraction. Powers early industry.',
      mapSprite: 'coal_mine', cityWeight: 0,
      odRate: 0.02,
    },
    {
      id: 'iron_mine',       name: 'Iron Mine',           icon: '🪨',
      tier: 'Resources',     tierColor: '#a0522d',
      category: 'resource',
      baseCost: 80,          costMult: 1.12,   baseProd: 3,
      unlockGDP: 50,
      desc: 'Extracts iron ore for steel production.',
      mapSprite: 'iron_mine', cityWeight: 0,
      odRate: 0.1,
    },
    {
      id: 'timber_mill',     name: 'Timber Mill',         icon: '🪵',
      tier: 'Resources',     tierColor: '#a0522d',
      category: 'resource',
      baseCost: 500,         costMult: 1.12,   baseProd: 15,
      unlockGDP: 300,
      desc: 'Processes lumber for construction and fuel.',
      mapSprite: 'timber_mill', cityWeight: 0,
      odRate: 0.4,
    },
    {
      id: 'oil_well',        name: 'Oil Well',            icon: '🛢️',
      tier: 'Resources',     tierColor: '#a0522d',
      category: 'resource',
      baseCost: 3_000,       costMult: 1.12,   baseProd: 80,
      unlockGDP: 2_000,
      desc: 'Extracts petroleum for fuel and petrochemicals.',
      mapSprite: 'oil_well', cityWeight: 0,
      odRate: 2,
    },
    {
      id: 'rare_earth_mine', name: 'Rare Earth Mine',     icon: '💎',
      tier: 'Resources',     tierColor: '#a0522d',
      category: 'resource',
      baseCost: 500_000,     costMult: 1.13,   baseProd: 8_000,
      unlockGDP: 300_000,
      desc: 'Critical minerals for advanced electronics.',
      mapSprite: 'rare_earth', cityWeight: 0,
      odRate: 150,
    },
    {
      id: 'nuclear_fuel',    name: 'Nuclear Fuel Plant',  icon: '☢️',
      tier: 'Resources',     tierColor: '#a0522d',
      category: 'resource',
      baseCost: 50_000_000,  costMult: 1.14,   baseProd: 500_000,
      unlockGDP: 30_000_000,
      desc: 'Enriched uranium for power generation.',
      mapSprite: 'nuclear_plant', cityWeight: 0,
      requiresTech: 'nuclear_eng',
      odRate: 8_000,
    },

    // ---- GOODS ----
    {
      id: 'grain_farm',      name: 'Grain Farm',          icon: '🌾',
      tier: 'Goods',         tierColor: '#27ae60',
      category: 'goods',
      baseCost: 200,         costMult: 1.11,   baseProd: 8,
      unlockGDP: 150,
      desc: 'Agricultural production. Feeds the workforce.',
      mapSprite: 'farm', cityWeight: 0.5,
      odRate: 0.3,
    },
    {
      id: 'steel_mill',      name: 'Steel Mill',          icon: '🏭',
      tier: 'Goods',         tierColor: '#27ae60',
      category: 'goods',
      baseCost: 500,         costMult: 1.13,   baseProd: 20,
      unlockGDP: 400,
      desc: 'Converts iron ore into structural steel.',
      mapSprite: 'steel_mill', cityWeight: 1,
      odRate: 0.8,
    },
    {
      id: 'textile_factory', name: 'Textile Factory',     icon: '🧵',
      tier: 'Goods',         tierColor: '#27ae60',
      category: 'goods',
      baseCost: 5_000,       costMult: 1.13,   baseProd: 150,
      unlockGDP: 3_500,
      desc: 'Clothing, fabrics, and consumer textiles.',
      mapSprite: 'textile', cityWeight: 1,
      odRate: 5,
    },

    // ---- INDUSTRY ----
    {
      id: 'auto_plant',      name: 'Automobile Plant',    icon: '🚗',
      tier: 'Industry',      tierColor: '#2980b9',
      category: 'industry',
      baseCost: 25_000,      costMult: 1.14,   baseProd: 600,
      unlockGDP: 18_000,
      desc: 'Mass production of motor vehicles.',
      mapSprite: 'auto_plant', cityWeight: 2,
      odRate: 20,
    },
    {
      id: 'appliance_factory', name: 'Appliance Factory', icon: '📺',
      tier: 'Industry',      tierColor: '#2980b9',
      category: 'industry',
      baseCost: 40_000,      costMult: 1.14,   baseProd: 900,
      unlockGDP: 30_000,
      desc: 'Dishwashers, televisions, washing machines.',
      mapSprite: 'appliance', cityWeight: 2,
      odRate: 30,
    },
    {
      id: 'shipyard',        name: 'Shipyard',             icon: '⚓',
      tier: 'Industry',      tierColor: '#2980b9',
      category: 'industry',
      baseCost: 150_000,     costMult: 1.14,   baseProd: 3_000,
      unlockGDP: 100_000,
      desc: 'Cargo and naval vessel construction.',
      mapSprite: 'shipyard', cityWeight: 2,
      requiresTech: 'nav',
      odRate: 80,
    },

    // ---- ADVANCED ----
    {
      id: 'chemical_plant',  name: 'Chemical Plant',      icon: '⚗️',
      tier: 'Advanced',      tierColor: '#1abc9c',
      category: 'advanced',
      baseCost: 200_000,     costMult: 1.15,   baseProd: 4_000,
      unlockGDP: 150_000,
      desc: 'Synthetic materials, plastics, pharmaceuticals.',
      mapSprite: 'chem_plant', cityWeight: 1,
      odRate: 120,
    },
    {
      id: 'electronics_fab', name: 'Electronics Fab',     icon: '💾',
      tier: 'Advanced',      tierColor: '#1abc9c',
      category: 'advanced',
      baseCost: 1_000_000,   costMult: 1.15,   baseProd: 18_000,
      unlockGDP: 750_000,
      desc: 'Semiconductors and computing components.',
      mapSprite: 'electronics', cityWeight: 3,
      requiresTech: 'computing',
      odRate: 500,
    },
    {
      id: 'aerospace_works', name: 'Aerospace Works',     icon: '🚀',
      tier: 'Advanced',      tierColor: '#1abc9c',
      category: 'advanced',
      baseCost: 10_000_000,  costMult: 1.15,   baseProd: 120_000,
      unlockGDP: 7_000_000,
      desc: 'Aircraft, satellites, and launch systems.',
      mapSprite: 'aerospace', cityWeight: 2,
      requiresTech: 'avionics',
      odRate: 3_000,
    },

    // ---- CYBERNETICS ----
    {
      id: 'robotics_plant',  name: 'Robotics Factory',    icon: '🤖',
      tier: 'Cybernetics',   tierColor: '#f39c12',
      category: 'cyber',
      baseCost: 10_000_000,  costMult: 1.16,   baseProd: 120_000,
      unlockGDP: 8_000_000,
      desc: 'Automated production systems.',
      mapSprite: 'robotics', cityWeight: 3,
      requiresTech: 'robotics_tech',
      odRate: 8_000,
    },
    {
      id: 'computing_center',name: 'Computing Center',    icon: '🖥️',
      tier: 'Cybernetics',   tierColor: '#f39c12',
      category: 'cyber',
      baseCost: 100_000_000, costMult: 1.16,   baseProd: 1_000_000,
      unlockGDP: 70_000_000,
      desc: 'Data processing and economic modelling.',
      mapSprite: 'computing', cityWeight: 3,
      requiresTech: 'networks',
      odRate: 50_000,
    },
    {
      id: 'space_program',   name: 'Space Program',       icon: '🛸',
      tier: 'Cybernetics',   tierColor: '#f39c12',
      category: 'cyber',
      baseCost: 1_000_000_000, costMult: 1.17, baseProd: 10_000_000,
      unlockGDP: 700_000_000,
      desc: 'Orbital infrastructure and resource extraction.',
      mapSprite: 'space_center', cityWeight: 5,
      requiresTech: 'ogas_tech',
      odRate: 300_000,
    },
  ];

  // ===========================================================
  //  DATA — LOGISTICS
  //
  //  Logistics upgrades are one-time GDP purchases that set a
  //  global transport multiplier. Each tier replaces (and exceeds)
  //  the previous. The multiplier is applied AFTER all generator
  //  production is summed.
  // ===========================================================

  const LOGISTICS = [
    {
      id: 'horse',      name: 'Horse-drawn Carts',   icon: '🐎',
      cost: 0,          mult: 1.0,    always: true,
      desc: 'Subsistence-level transport. Always active.',
      mapFeature: null,
      odBonus: 0,
    },
    {
      id: 'railway',    name: 'Railway Network',      icon: '🚂',
      cost: 1_000,      mult: 1.5,    requires: 'horse',
      desc: 'Rail connects industrial zones. +50% output.',
      mapFeature: 'rail_lines',
      requiresTech: 'rail_eng',
      odBonus: 0.3,
    },
    {
      id: 'trucking',   name: 'Trucking Fleet',       icon: '🚛',
      cost: 20_000,     mult: 2.2,    requires: 'railway',
      desc: 'Road freight fills the gaps. ×2.2 logistics.',
      mapFeature: 'roads',
      odBonus: 0.5,
    },
    {
      id: 'shipping',   name: 'Container Shipping',   icon: '🚢',
      cost: 500_000,    mult: 3.5,    requires: 'trucking',
      desc: 'Ocean freight opens global trade. ×3.5.',
      mapFeature: 'shipping_lanes',
      requiresTech: 'nav',
      odBonus: 0.8,
    },
    {
      id: 'airfreight', name: 'Air Freight',           icon: '✈️',
      cost: 5_000_000,  mult: 6.0,    requires: 'shipping',
      desc: 'Rapid logistics, time-sensitive goods. ×6.',
      mapFeature: 'air_routes',
      requiresTech: 'avionics',
      odBonus: 1.2,
    },
    {
      id: 'fiber',      name: 'Fiber Optic Grid',      icon: '🌐',
      cost: 50_000_000, mult: 12.0,   requires: 'airfreight',
      desc: 'Digital coordination across all sectors. ×12.',
      mapFeature: 'fiber_net',
      requiresTech: 'networks',
      odBonus: 2.0,
    },
  ];

  // ===========================================================
  //  DATA — COMPUTING ROOMS
  //
  //  Rooms installed on tower floors to generate Information
  //  Processing Capacity (IPC). Each room tier replaces
  //  the previous. Built with GDP, generates IPC/s.
  //  IPC vs Organized Data delta creates planning efficiency.
  // ===========================================================

  const COMPUTING_ROOMS = [
    // Each tier's IPC/room is calibrated so maxing it out keeps pace with
    // the generator tier that unlocks around the same GDP threshold.
    // Rule of thumb: roomsMax × ipcPerRoom ≈ OD/s from that era's generators.
    {
      id: 'pen_paper',    name: 'Pen & Paper Clerks',  icon: '📝',
      cost: 150,          ipcPerRoom: 5,
      desc: 'Clerks with ledgers manually track production figures.',
      flavorText: 'Gosplan\'s army of statisticians.',
      unlockGDP: 0,
      roomsMax: 50,
    },
    {
      id: 'typewriters',  name: 'Typewriter Pool',     icon: '⌨️',
      cost: 1_500,        ipcPerRoom: 40,
      desc: 'Typed reports and tabulations speed the flow of data.',
      flavorText: 'Carbon paper in triplicate.',
      unlockGDP: 800,
      roomsMax: 50,
    },
    {
      id: 'punch_cards',  name: 'Punch Card Bureau',   icon: '🗃️',
      cost: 15_000,       ipcPerRoom: 300,
      desc: 'Tabulating machines process punch cards at scale.',
      flavorText: 'The IBM 360 arrives in Moscow.',
      unlockGDP: 8_000,
      roomsMax: 40,
    },
    {
      id: 'mainframe_ural', name: 'URAL Mainframe',    icon: '🖨️',
      cost: 400_000,      ipcPerRoom: 4_000,
      desc: 'Soviet mainframes handle complex economic models.',
      flavorText: 'Glushkov\'s dream: the OGAS precursor.',
      unlockGDP: 150_000,
      roomsMax: 30,
    },
    {
      id: 'mainframe_es', name: 'ES EVM Mainframe',    icon: '💻',
      cost: 4_000_000,    ipcPerRoom: 50_000,
      desc: 'The Ryad series: IBM-compatible Soviet mainframes.',
      flavorText: 'Compatible with the West, built in the East.',
      unlockGDP: 1_500_000,
      roomsMax: 25,
      requiresTech: 'computing',
    },
    {
      id: 'minicomputers', name: 'Minicomputer Network', icon: '🖥️',
      cost: 40_000_000,   ipcPerRoom: 600_000,
      desc: 'Networked minis link factory floors to the planning centre.',
      flavorText: 'Project Cybersyn: the Cyberfolk dream.',
      unlockGDP: 15_000_000,
      roomsMax: 20,
      requiresTech: 'networks',
    },
    {
      id: 'cloud_cluster', name: 'Cloud Cluster',      icon: '☁️',
      cost: 400_000_000,  ipcPerRoom: 8_000_000,
      desc: 'Distributed cloud processing — real-time national planning.',
      flavorText: 'OGAS at last. Glushkov vindicated.',
      unlockGDP: 200_000_000,
      roomsMax: 15,
      requiresTech: 'ogas_tech',
    },
    {
      id: 'quantum_node',  name: 'Quantum Planning Node', icon: '⚛️',
      cost: 10_000_000_000, ipcPerRoom: 200_000_000,
      desc: 'Quantum processors solve the full allocation problem in microseconds.',
      flavorText: 'Every allocation optimal. The plan is perfect.',
      unlockGDP: 5_000_000_000,
      roomsMax: 10,
      requiresTech: 'nuclear_eng',
    },
  ];

  // ===========================================================
  //  DATA — TOWER DEPARTMENTS
  //
  //  Departments unlock floors of the EconPlan Tower.
  //  Each has a GDP cost and applies a multiplier category.
  //  multiplierType:
  //    'global'     — multiplies all GDP/s
  //    'resources'  — multiplies resource-tier generators only
  //    'goods'      — multiplies goods-tier generators only
  //    'industry'   — multiplies industry+advanced+cyber tiers
  //    'logistics'  — stacks on the logistics multiplier
  //    'research'   — multiplies RP/s
  //    'prestige'   — enables / boosts prestige mechanic
  // ===========================================================

  const DEPARTMENTS = [
    {
      id: 'stats',    name: 'Statistics Bureau',   icon: '📊', floor: 1,
      cost: 500,
      multiplierType: 'global',   multiplierValue: 1.10,
      effect: 'All production +10%',
      desc: 'Central data collection. Optimises planning.',
      flavorText: 'Without data, we are blind. With it, we plan.',
    },
    {
      id: 'agri',     name: 'Agriculture Dept.',   icon: '🌿', floor: 2,
      cost: 5_000,
      multiplierType: 'goods_food', multiplierValue: 1.5,
      effect: 'Food sector output ×1.5',
      desc: 'Coordinates collective farming and irrigation.',
      flavorText: 'The collective feeds the nation.',
    },
    {
      id: 'industry', name: 'Industry Dept.',      icon: '⚙️', floor: 3,
      cost: 30_000,
      multiplierType: 'industry',   multiplierValue: 1.5,
      effect: 'Factory output ×1.5',
      desc: 'Heavy industry coordination and quota setting.',
      flavorText: 'Steel is the skeleton of civilization.',
    },
    {
      id: 'transport',name: 'Transport Dept.',     icon: '🗺️', floor: 4,
      cost: 100_000,
      multiplierType: 'logistics',  multiplierValue: 1.5,
      effect: 'Logistics multiplier ×1.5',
      desc: 'Coordinates all transport and supply chains.',
      flavorText: 'The revolution travels on iron rails.',
    },
    {
      id: 'finance',  name: 'Finance Dept.',       icon: '💰', floor: 5,
      cost: 500_000,
      multiplierType: 'research',   multiplierValue: 2.0,
      effect: 'Research speed ×2',
      desc: 'Capital allocation and economic modelling.',
      flavorText: 'Investment today is production tomorrow.',
    },
    {
      id: 'trade',    name: 'Foreign Trade',       icon: '🌏', floor: 6,
      cost: 2_000_000,
      multiplierType: 'global',     multiplierValue: 1.35,
      effect: 'All GDP ×1.35',
      desc: 'Export coordination and trade agreements.',
      flavorText: 'Trade builds bridges; bridges carry goods.',
    },
    {
      id: 'energy',   name: 'Energy Ministry',     icon: '⚡', floor: 7,
      cost: 10_000_000,
      multiplierType: 'global',     multiplierValue: 1.8,
      effect: 'Production ×1.8',
      desc: 'Grid management and energy policy.',
      flavorText: 'Electrification transforms the countryside.',
    },
    {
      id: 'science',  name: 'Science Academy',     icon: '🔬', floor: 8,
      cost: 50_000_000,
      multiplierType: 'research',   multiplierValue: 2.0,
      effect: 'Research ×2, +5 RP/s base',
      desc: 'State research coordination and funding.',
      flavorText: 'Science is the compass of the future.',
      rpBonus: 5,
    },
    {
      id: 'cyber',    name: 'Cybernetics Div.',    icon: '🖥️', floor: 9,
      cost: 500_000_000,
      multiplierType: 'global',     multiplierValue: 2.0,
      effect: 'Enables OGAS system, ×2 production',
      desc: 'Economic cybernetics and systems theory.',
      flavorText: 'Every factory is a neuron in the plan.',
      requiresTech: 'ai_planning',
    },
    {
      id: 'ogas',     name: 'OGAS / Cybersyn',     icon: '🌐', floor: 10,
      cost: 5_000_000_000,
      multiplierType: 'prestige',   multiplierValue: 10.0,
      effect: 'ALL production ×10. Enables Five-Year Plan cycle.',
      desc: 'Nationwide economic cybernetics. The final system.',
      flavorText: 'The plan sees all, knows all, optimises all.',
      requiresDept: 'cyber',
      requiresTech: 'ogas_tech',
      enablesPrestige: true,
    },
  ];

  // ===========================================================
  //  DATA — RESEARCH TECH TREE
  //
  //  Organised into 4 columns × up to 5 rows.
  //  Each tech costs Research Points and may gate generators,
  //  logistics, or departments.
  //
  //  effects[] — array of effect descriptors applied by Math layer:
  //    { type: 'gen_mult', target: 'gen_id|category', value: 1.5 }
  //    { type: 'global_mult', value: 1.5 }
  //    { type: 'rp_mult', value: 2 }
  //    { type: 'logistics_mult', value: 1.3 }
  //    { type: 'unlock', target: 'gen_id|logi_id|dept_id' }
  // ===========================================================

  const TECHS = [
    // Column 0 — Agriculture (unlocks food/farming bonuses)
    {
      id: 'basic_agri',  name: 'Basic Agriculture', icon: '🌱',
      col: 0, row: 0,    cost: 5,      requires: null,
      desc: 'Soil analysis and crop rotation.',
      effects: [{ type: 'gen_mult', target: 'grain_farm', value: 1.5 }],
      displayEffect: 'Grain Farm ×1.5',
    },
    {
      id: 'irrigation',  name: 'Irrigation',         icon: '💧',
      col: 0, row: 1,    cost: 20,     requires: 'basic_agri',
      desc: 'Canal networks for reliable water supply.',
      effects: [{ type: 'gen_mult', target: 'grain_farm', value: 2.0 }],
      displayEffect: 'Agriculture ×2',
    },
    {
      id: 'mech_farming',name: 'Mechanised Farming',  icon: '🚜',
      col: 0, row: 2,    cost: 80,     requires: 'irrigation',
      desc: 'Tractors replace manual labour at scale.',
      effects: [{ type: 'cat_mult', target: 'goods_food', value: 3.0 }],
      displayEffect: 'All food output ×3',
    },
    {
      id: 'agro_chem',   name: 'Agro-Chemicals',      icon: '🧪',
      col: 0, row: 3,    cost: 300,    requires: 'mech_farming',
      desc: 'Synthetic fertilisers and pesticides.',
      effects: [{ type: 'cat_mult', target: 'goods_food', value: 5.0 }],
      displayEffect: 'Food sector ×5',
    },
    {
      id: 'biotech',     name: 'Biotechnology',        icon: '🧬',
      col: 0, row: 4,    cost: 1_500,  requires: 'agro_chem',
      desc: 'Genetic crop improvement and yield maximisation.',
      effects: [{ type: 'cat_mult', target: 'goods_food', value: 8.0 }],
      displayEffect: 'Food sector ×8',
    },

    // Column 1 — Industry
    {
      id: 'basic_ind',   name: 'Basic Industry',       icon: '🏗️',
      col: 1, row: 0,    cost: 10,     requires: null,
      desc: 'Standardised parts and early production lines.',
      effects: [{ type: 'gen_mult', target: 'steel_mill', value: 1.5 }],
      displayEffect: 'Steel Mill ×1.5',
    },
    {
      id: 'mass_prod',   name: 'Mass Production',      icon: '🔧',
      col: 1, row: 1,    cost: 40,     requires: 'basic_ind',
      desc: 'Assembly lines and Taylorist work organisation.',
      effects: [
        { type: 'cat_mult', target: 'goods',    value: 2.0 },
        { type: 'cat_mult', target: 'industry', value: 2.0 },
      ],
      displayEffect: 'All factories ×2',
    },
    {
      id: 'automation',  name: 'Automation',            icon: '⚙️',
      col: 1, row: 2,    cost: 150,    requires: 'mass_prod',
      desc: 'Feedback control systems and mechanised lines.',
      effects: [
        { type: 'cat_mult', target: 'industry', value: 3.0 },
        { type: 'cat_mult', target: 'advanced', value: 2.0 },
      ],
      displayEffect: 'Industry ×3, Advanced ×2',
    },
    {
      id: 'robotics_tech', name: 'Robotics',            icon: '🤖',
      col: 1, row: 3,    cost: 600,    requires: 'automation',
      desc: 'Programmable manipulators replace human operators.',
      effects: [
        { type: 'cat_mult', target: 'industry', value: 5.0 },
        { type: 'cat_mult', target: 'advanced', value: 4.0 },
        { type: 'unlock',   target: 'robotics_plant' },
      ],
      displayEffect: 'Industry ×5, unlocks Robotics Factory',
    },
    {
      id: 'nano_mfg',    name: 'Nano-Manufacturing',    icon: '🔩',
      col: 1, row: 4,    cost: 3_000,  requires: 'robotics_tech',
      desc: 'Molecular-scale precision manufacturing.',
      effects: [
        { type: 'cat_mult', target: 'cyber',    value: 10.0 },
        { type: 'global_mult', value: 1.5 },
      ],
      displayEffect: 'Cyber ×10, Global ×1.5',
    },

    // Column 2 — Transport
    {
      id: 'road_build',  name: 'Road Building',         icon: '🛣️',
      col: 2, row: 0,    cost: 15,     requires: null,
      desc: 'Paved roads connecting cities and factories.',
      effects: [{ type: 'logistics_mult', value: 1.3 }],
      displayEffect: 'Logistics ×1.3',
    },
    {
      id: 'rail_eng',    name: 'Rail Engineering',       icon: '🚂',
      col: 2, row: 1,    cost: 60,     requires: 'road_build',
      desc: 'Steam and diesel locomotive infrastructure.',
      effects: [
        { type: 'logistics_mult', value: 1.2 },
        { type: 'unlock', target: 'railway' },
      ],
      displayEffect: 'Logistics ×1.2, unlocks Railway',
    },
    {
      id: 'nav',         name: 'Navigation',             icon: '⚓',
      col: 2, row: 2,    cost: 200,    requires: 'rail_eng',
      desc: 'Deep-water ports and maritime navigation.',
      effects: [
        { type: 'unlock', target: 'shipping' },
        { type: 'unlock', target: 'shipyard' },
      ],
      displayEffect: 'Unlocks Shipping & Shipyard',
    },
    {
      id: 'avionics',    name: 'Avionics',                icon: '✈️',
      col: 2, row: 3,    cost: 800,    requires: 'nav',
      desc: 'Civil aviation and aerial logistics systems.',
      effects: [
        { type: 'unlock', target: 'airfreight' },
        { type: 'unlock', target: 'aerospace_works' },
        { type: 'logistics_mult', value: 1.5 },
      ],
      displayEffect: 'Unlocks Air Freight & Aerospace, ×1.5',
    },
    {
      id: 'space_log',   name: 'Space Logistics',         icon: '🛰️',
      col: 2, row: 4,    cost: 5_000,  requires: 'avionics',
      desc: 'Orbital supply depots and satellite coordination.',
      effects: [
        { type: 'logistics_mult', value: 2.0 },
        { type: 'global_mult',    value: 2.0 },
      ],
      displayEffect: 'Logistics ×2, Global ×2',
    },

    // Column 3 — Cybernetics
    {
      id: 'computing',   name: 'Computing',               icon: '💻',
      col: 3, row: 0,    cost: 50,     requires: null,
      desc: 'Vacuum tubes to transistors. Early computers.',
      effects: [
        { type: 'rp_mult', value: 2.0 },
        { type: 'unlock',  target: 'electronics_fab' },
      ],
      displayEffect: 'RP gen ×2, unlocks Electronics Fab',
    },
    {
      id: 'networks',    name: 'Networks',                 icon: '📡',
      col: 3, row: 1,    cost: 200,    requires: 'computing',
      desc: 'Wide-area networks linking planning nodes.',
      effects: [
        { type: 'global_mult', value: 1.5 },
        { type: 'unlock',      target: 'fiber' },
        { type: 'unlock',      target: 'computing_center' },
      ],
      displayEffect: 'Global ×1.5, unlocks Fiber & Computing Center',
    },
    {
      id: 'ai_planning', name: 'AI Planning',              icon: '🧠',
      col: 3, row: 2,    cost: 800,    requires: 'networks',
      desc: 'Machine learning for economic optimisation.',
      effects: [
        { type: 'global_mult', value: 2.0 },
        { type: 'rp_mult',     value: 2.0 },
      ],
      displayEffect: 'All production ×2, RP ×2',
    },
    {
      id: 'ogas_tech',   name: 'OGAS Protocol',            icon: '🌐',
      col: 3, row: 3,    cost: 3_000,  requires: 'ai_planning',
      desc: 'All-state automated economic management system.',
      effects: [
        { type: 'global_mult', value: 3.0 },
        { type: 'unlock',      target: 'ogas' },
        { type: 'unlock',      target: 'space_program' },
      ],
      displayEffect: 'Global ×3, unlocks OGAS dept & Space Program',
    },
    {
      id: 'nuclear_eng', name: 'Nuclear Engineering',      icon: '⚛️',
      col: 3, row: 4,    cost: 10_000, requires: 'ogas_tech',
      desc: 'Fission and fusion energy systems.',
      effects: [
        { type: 'global_mult', value: 5.0 },
        { type: 'unlock',      target: 'nuclear_fuel' },
      ],
      displayEffect: 'Global ×5, unlocks Nuclear Fuel Plant',
    },
  ];

  // ===========================================================
  //  DATA — MILESTONES
  //
  //  Triggered by totalGDP (all-time). One-shot. May grant
  //  bonuses applied as multipliers in the Math layer.
  // ===========================================================

  const MILESTONES = [
    {
      id: 'ms_1k',   name: 'First Thousand',      icon: '🏅',
      threshold: 1_000,
      desc: 'Reach $1K total GDP',
      reward: 'Unlocks Iron Mine',
      effects: [],
    },
    {
      id: 'ms_10k',  name: 'Small Industry',       icon: '🏅',
      threshold: 10_000,
      desc: 'Reach $10K total GDP',
      reward: 'Resources +15%',
      effects: [{ type: 'cat_mult', target: 'resource', value: 1.15 }],
    },
    {
      id: 'ms_100k', name: 'Regional Power',        icon: '🥈',
      threshold: 100_000,
      desc: 'Reach $100K total GDP',
      reward: 'Goods production +20%',
      effects: [{ type: 'cat_mult', target: 'goods', value: 1.2 }],
    },
    {
      id: 'ms_1m',   name: 'First Million',         icon: '🥇',
      threshold: 1_000_000,
      desc: 'Reach $1M total GDP',
      reward: 'All production +10%',
      effects: [{ type: 'global_mult', value: 1.1 }],
    },
    {
      id: 'ms_10m',  name: 'Industrialised',         icon: '🏆',
      threshold: 10_000_000,
      desc: 'Reach $10M total GDP',
      reward: 'Industry ×1.5',
      effects: [{ type: 'cat_mult', target: 'industry', value: 1.5 }],
    },
    {
      id: 'ms_1b',   name: 'Industrial Power',       icon: '🏆',
      threshold: 1_000_000_000,
      desc: 'Reach $1B total GDP',
      reward: 'Logistics ×1.5',
      effects: [{ type: 'logistics_mult', value: 1.5 }],
    },
    {
      id: 'ms_1t',   name: 'Economic Superpower',    icon: '⭐',
      threshold: 1_000_000_000_000,
      desc: 'Reach $1T total GDP',
      reward: 'Research speed ×2',
      effects: [{ type: 'rp_mult', value: 2.0 }],
    },
    {
      id: 'ms_1qa',  name: 'Planned Economy',        icon: '🌟',
      threshold: 1e15,
      desc: 'Reach $1Qa total GDP',
      reward: 'All departments ×2',
      effects: [{ type: 'dept_mult', value: 2.0 }],
    },
    {
      id: 'ms_1qi',  name: 'Full Communism',          icon: '🌠',
      threshold: 1e18,
      desc: 'Reach $1Qi total GDP',
      reward: 'Global production ×5',
      effects: [{ type: 'global_mult', value: 5.0 }],
    },
  ];

  // ===========================================================
  //  DATA — PLANNERS (Prestige characters)
  //
  //  Unlocked by cumulative planning stars. Provide permanent
  //  run-carry-over bonuses. Described as historical economists
  //  and cybernetics pioneers.
  // ===========================================================

  const PLANNERS = [
    {
      id: 'anna',      name: 'Gosplan Anna',           icon: '👩‍💼',
      starsRequired: 1,
      bio: 'Head statistician, Gosplan. Turns raw data into quotas.',
      bonus: 'All resource output +25%',
      effects: [{ type: 'cat_mult', target: 'resource', value: 1.25 }],
    },
    {
      id: 'dmitri',    name: 'Engineer Dmitri',         icon: '👷',
      starsRequired: 3,
      bio: 'Chief industrial engineer. Master of the assembly line.',
      bonus: 'Factory efficiency ×1.5',
      effects: [
        { type: 'cat_mult', target: 'goods',    value: 1.5 },
        { type: 'cat_mult', target: 'industry', value: 1.5 },
      ],
    },
    {
      id: 'vera',      name: 'Logistics Vera',          icon: '🗺️',
      starsRequired: 6,
      bio: 'Transport minister. Built the Eastern rail network.',
      bonus: 'Transport multiplier ×2',
      effects: [{ type: 'logistics_mult', value: 2.0 }],
    },
    {
      id: 'viktor',    name: 'Cybernetics Viktor',      icon: '🖥️',
      starsRequired: 10,
      bio: 'Pioneer of economic cybernetics. Dreamed of OGAS.',
      bonus: 'Research speed +50%, RP/s ×1.5',
      effects: [{ type: 'rp_mult', value: 1.5 }],
    },
    {
      id: 'stafford',  name: 'Stafford Beer',           icon: '🧠',
      starsRequired: 15,
      bio: 'Architect of Project Cybersyn. Management cybernetics.',
      bonus: 'All department multipliers ×1.5',
      effects: [{ type: 'dept_mult', value: 1.5 }],
    },
    {
      id: 'chen',      name: 'Director Chen',           icon: '🏛️',
      starsRequired: 20,
      bio: 'Bureau director. Doubled GDP conversion twice over.',
      bonus: 'Global GDP ×2',
      effects: [{ type: 'global_mult', value: 2.0 }],
    },
    {
      id: 'architect', name: 'The Architect',           icon: '📐',
      starsRequired: 35,
      bio: 'Unknown. Designed the tower itself. The plan made flesh.',
      bonus: 'Tower departments ×3',
      effects: [{ type: 'dept_mult', value: 3.0 }],
    },
  ];

  // ===========================================================
  //  DATA — TICKER MESSAGES (gated by unlock conditions)
  //
  //  Each entry has:
  //    text  — the broadcast message
  //    req   — array of requirements, ALL must be met to show
  //            { t: 'gen'|'logi'|'dept'|'tech'|'milestone', id }
  //            empty req [] = always visible
  // ===========================================================

  const TICKER_MSGS = [
    // Always available from the start
    { text: 'CENTRAL PLANNING COMMITTEE ISSUES NEW DIRECTIVES',           req: [] },
    { text: 'WORKERS MOBILISE FOR THE FIVE-YEAR PLAN',                    req: [] },
    { text: 'BUREAU OF STATISTICS BEGINS RECORDING ECONOMIC INDICATORS',  req: [] },
    { text: 'PLANNING COMMITTEE CONVENES TO REVIEW INDICATORS',           req: [] },

    // Requires coal mine
    { text: 'COAL EXTRACTION EXCEEDS MONTHLY TARGET',                     req: [{ t: 'gen', id: 'coal_mine' }] },
    { text: 'SURFACE MINING CREW REPORTS RECORD OUTPUT',                  req: [{ t: 'gen', id: 'coal_mine' }] },

    // Requires iron mine
    { text: 'IRON ORE RESERVE DISCOVERED IN EASTERN DISTRICT',            req: [{ t: 'gen', id: 'iron_mine' }] },

    // Requires grain farm
    { text: 'AGRICULTURAL COLLECTIVE REPORTS RECORD GRAIN HARVEST',       req: [{ t: 'gen', id: 'grain_farm' }] },

    // Requires steel mill
    { text: 'STEEL OUTPUT EXCEEDS FIVE-YEAR PLAN PROJECTIONS',            req: [{ t: 'gen', id: 'steel_mill' }] },
    { text: 'MINISTRY OF PLANNING APPROVES FORTY NEW FACTORIES',          req: [{ t: 'gen', id: 'steel_mill' }] },

    // Requires textile factory
    { text: 'NEW TEXTILE STANDARD INCREASES OUTPUT BY EIGHTEEN PERCENT',  req: [{ t: 'gen', id: 'textile_factory' }] },
    { text: 'CONSUMER GOODS SURPLUS REPORTED IN WESTERN DISTRICTS',       req: [{ t: 'gen', id: 'textile_factory' }] },

    // Requires railway logistics
    { text: 'NEW RAILWAY LINE CONNECTS EASTERN INDUSTRIAL ZONE',          req: [{ t: 'logi', id: 'railway' }] },
    { text: 'LOCOMOTIVE FLEET EXPANDED BY THIRTY UNITS',                  req: [{ t: 'logi', id: 'railway' }] },

    // Requires shipping logistics
    { text: 'SHIPYARD NUMBER FOUR LAUNCHES FIRST CONTAINER VESSEL',       req: [{ t: 'logi', id: 'shipping' }] },
    { text: 'MARITIME TRADE CORRIDOR OPENS TO EASTERN MARKETS',          req: [{ t: 'logi', id: 'shipping' }] },

    // Requires air freight
    { text: 'AIR FREIGHT CORRIDOR REDUCES DELIVERY TIME BY 60%',         req: [{ t: 'logi', id: 'airfreight' }] },

    // Requires Stats Bureau department
    { text: 'PRODUCTION QUOTAS MET FOR THIRD CONSECUTIVE QUARTER',       req: [{ t: 'dept', id: 'stats' }] },
    { text: 'FIVE-YEAR PLAN ON TRACK — CENTRAL COMMITTEE REPORTS',       req: [{ t: 'dept', id: 'stats' }] },

    // Requires Science Academy
    { text: 'RESEARCH ACADEMY ANNOUNCES BREAKTHROUGH IN AUTOMATION',     req: [{ t: 'dept', id: 'science' }] },
    { text: 'TECHNOLOGY TRANSFER ACCELERATES INDUSTRIALISATION',         req: [{ t: 'dept', id: 'science' }] },

    // Requires Energy Ministry
    { text: 'ENERGY GRID EXPANSION REACHES RURAL COLLECTIVES',           req: [{ t: 'dept', id: 'energy' }] },

    // Requires electronics fab
    { text: 'ELECTRONICS FABRICATION PLANT EXCEEDS QUOTA',               req: [{ t: 'gen', id: 'electronics_fab' }] },

    // Requires robotics plant
    { text: 'ROBOTICS PILOT PROGRAMME REDUCES FACTORY ERRORS',           req: [{ t: 'gen', id: 'robotics_plant' }] },

    // Requires Cybernetics Division
    { text: 'CYBERNETICS DIVISION COMPLETES PHASE ONE OF OGAS',          req: [{ t: 'dept', id: 'cyber' }] },
    { text: 'LOGISTICS NETWORK EXPANSION BOOSTS REGIONAL OUTPUT',        req: [{ t: 'dept', id: 'cyber' }] },
    { text: 'OGAS NETWORK NODE INSTALLED IN NORTHERN SECTOR',            req: [{ t: 'dept', id: 'ogas' }] },

    // Requires space program
    { text: 'SPACE PROGRAMME LAUNCHES FIRST ECONOMIC SURVEY SATELLITE',  req: [{ t: 'gen', id: 'space_program' }] },

    // Computing / information economy
    { text: 'CENTRAL STATISTICAL OFFICE OVERWHELMED BY INCOMING PRODUCTION REPORTS', req: [] },
    { text: 'PLANNING BUREAUS UNABLE TO PROCESS ALL AVAILABLE ECONOMIC DATA',        req: [] },
    { text: 'GOSPLAN RECEIVES 12 MILLION PRODUCT CATEGORIES FOR MANUAL PROCESSING',  req: [] },
    { text: 'TYPEWRITER POOL EXPANDS TO MEET STATISTICAL REPORTING DEMANDS',         req: [{ t: 'dept', id: 'stats' }] },
    { text: 'GLUSHKOV PROPOSES NATIONAL COMPUTER NETWORK FOR ECONOMIC MANAGEMENT',   req: [{ t: 'dept', id: 'stats' }] },
    { text: 'URAL MAINFRAME INSTALLATION ACCELERATES QUOTA CALCULATION',             req: [{ t: 'dept', id: 'finance' }] },
    { text: 'INFORMATION BOTTLENECK CITED AS PRIMARY CAUSE OF PLANNING ERRORS',      req: [{ t: 'dept', id: 'finance' }] },
    { text: 'PROJECT CYBERSYN: REAL-TIME ECONOMIC TELEMETRY ACROSS CHILE',           req: [{ t: 'tech', id: 'networks' }] },
    { text: 'OGAS NETWORK WOULD PROCESS ALL ENTERPRISE DATA WITHIN 20 MINUTES',     req: [{ t: 'tech', id: 'networks' }] },
    { text: 'CLOUD COMPUTING ENABLES REAL-TIME NATIONAL ECONOMIC OPTIMISATION',      req: [{ t: 'tech', id: 'ogas_tech' }] },
    { text: 'PLANNING EFFICIENCY AT MAXIMUM — THE ALGORITHM SEES ALL',               req: [{ t: 'dept', id: 'ogas' }] },
  ];

  // ===========================================================
  //  STATE SCHEMA
  // ===========================================================

  function createDefaultState() {
    return {
      _version: SCHEMA_VERSION,

      // Primary currencies
      gdp:        0,   // current spendable GDP
      totalGDP:   0,   // all-time GDP (milestones, prestige)
      peakGDP:    0,   // peak current-run GDP (prestige calc)
      rp:         0,   // research points
      totalRP:    0,   // all-time RP earned

      // Information Economy currencies
      od:         0,   // Organized Data (accumulates from production)
      ipc:        0,   // Information Processing Capacity (from tower rooms)
      totalOD:    0,   // all-time OD generated
      totalIPC:   0,   // all-time IPC generated

      // Computing rooms: { [roomId]: { count: number } }
      computingRooms: {},

      // Prestige
      planningStars:  0,
      totalPrestiges: 0,
      bestRun:        0,   // peak GDP of best completed run

      // Collections — keyed by entity id
      generators:  {},  // { [id]: { owned: number } }
      logistics:   { horse: true },
      departments: {},
      techs:       {},
      milestones:  {},
      planners:    [],  // array of unlocked planner ids

      // Kickstart
      kickstartClicks: 0,

      // Settings
      buyQty: 1,        // 1 | 10 | 100 | 'max'

      // Timing
      lastTick:   Date.now(),
      lastSave:   Date.now(),
      sessionStart: Date.now(),
      totalPlaytime: 0,  // seconds

      // Statistics (for UI and debugging)
      stats: {
        gdpEarned:       0,
        generatorsBought: 0,
        techsResearched:  0,
        logisticsUnlocked: 0,
        deptsBuilt:       0,
        prestigeCount:    0,
      },
    };
  }

  // Active mutable state
  let G = createDefaultState();

  // ===========================================================
  //  EVENT BUS
  //
  //  Lightweight observer pattern. UI, map, and tower modules
  //  subscribe to events emitted by the engine.
  //
  //  Events:
  //    'tick'           — every game tick, payload: { gdps, rps, dt }
  //    'gdp_change'     — GDP changed, payload: { gdp, delta }
  //    'gen_bought'     — generator purchased, payload: { id, qty, owned }
  //    'tech_researched'— tech unlocked, payload: { id }
  //    'logi_unlocked'  — logistics tier unlocked, payload: { id }
  //    'dept_built'     — department established, payload: { id }
  //    'milestone'      — milestone achieved, payload: { id, name }
  //    'prestige'       — prestige completed, payload: { stars, total }
  //    'planner_unlock' — planner character unlocked, payload: { id }
  //    'save'           — game saved
  //    'load'           — game loaded, payload: { offlineSeconds }
  //    'notify'         — notification message, payload: { msg, type }
  // ===========================================================

  const _listeners = {};

  function on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
    return () => off(event, fn); // returns unsubscribe function
  }

  function off(event, fn) {
    if (_listeners[event]) {
      _listeners[event] = _listeners[event].filter(f => f !== fn);
    }
  }

  function emit(event, payload = {}) {
    (_listeners[event] || []).forEach(fn => {
      try { fn(payload); } catch (e) { console.error('[EPTT Event]', event, e); }
    });
  }

  // ===========================================================
  //  MATH ENGINE
  //  All pure functions — no state mutation, no side effects.
  // ===========================================================

  const Math_ = {

    /**
     * Cost to buy `qty` of a generator when `owned` are already owned.
     * Uses geometric series sum: b * r^k * (r^n - 1) / (r - 1)
     * For qty=1: simply b * r^k
     */
    genCost(gen, owned, qty = 1) {
      const r = gen.costMult || COST_MULT_DEFAULT;
      const b = gen.baseCost * Math.pow(r, owned);
      if (qty === 1) return b;
      return b * (Math.pow(r, qty) - 1) / (r - 1);
    },

    /**
     * Maximum number of a generator that can be purchased
     * with the given budget, using the closed-form formula
     * from "The Math of Idle Games, Part I".
     */
    genMaxBuy(gen, owned, budget) {
      const r   = gen.costMult || COST_MULT_DEFAULT;
      const b   = gen.baseCost * Math.pow(r, owned);
      if (budget < b) return 0;
      return Math.floor(Math.log((budget * (r - 1) / b) + 1) / Math.log(r));
    },

    /**
     * Collects all multiplier effects from a given source array
     * (techs, milestones, planners) for a specific effect type.
     */
    collectEffects(effectType, target = null) {
      let mult = 1;

      const apply = effects => {
        (effects || []).forEach(e => {
          if (e.type !== effectType) return;
          if (target !== null && e.target !== undefined && e.target !== target) return;
          mult *= (e.value || 1);
        });
      };

      // Active techs
      TECHS.forEach(t => { if (G.techs[t.id]) apply(t.effects); });

      // Achieved milestones
      MILESTONES.forEach(ms => { if (G.milestones[ms.id]) apply(ms.effects); });

      // Active planners
      PLANNERS.forEach(p => { if (G.planners.includes(p.id)) apply(p.effects); });

      return mult;
    },

    /**
     * Production of a single generator (GDP/s per unit × units owned).
     * Applies tech, planner, and milestone multipliers.
     */
    genProduction(gen) {
      const owned = G.generators[gen.id]?.owned || 0;
      if (owned === 0) return 0;

      const baseProd = gen.baseProd * owned;

      // Per-generator tech mult
      const genMult = Math_.collectEffects('gen_mult', gen.id);

      // Category mult
      const catMult = Math_.collectEffects('cat_mult', gen.category);

      // Food category (grain_farm is 'goods' category but also food)
      const foodMult = gen.id === 'grain_farm' ? Math_.collectEffects('cat_mult', 'goods_food') : 1;

      // Department category multipliers (Agriculture Dept boosts goods_food, Industry Dept boosts industry)
      let deptCatMult = 1;
      DEPARTMENTS.forEach(dept => {
        if (!G.departments[dept.id]) return;
        if (dept.multiplierType === 'goods_food' && gen.id === 'grain_farm') {
          deptCatMult *= (dept.multiplierValue || 1);
        }
        if (dept.multiplierType === 'industry' && ['industry', 'advanced', 'cyber'].includes(gen.category)) {
          deptCatMult *= (dept.multiplierValue || 1);
        }
      });

      return baseProd * genMult * catMult * Math.max(foodMult, 1) * deptCatMult;
    },

    /**
     * Total raw production of all generators (before logistics/tower/global).
     */
    totalRawProduction() {
      return GENERATORS.reduce((sum, gen) => sum + Math_.genProduction(gen), 0);
    },

    /**
     * Logistics multiplier — highest active tier's mult, modified by
     * tech bonuses, Transport Dept, and Planner Vera.
     */
    logisticsMult() {
      // Base: highest unlocked logistics tier
      let base = 1;
      LOGISTICS.forEach(l => { if (G.logistics[l.id]) base = l.mult; });

      // Tech logistics_mult effects
      const techMult = Math_.collectEffects('logistics_mult');

      // Transport department
      const deptMult = G.departments['transport']
        ? (DEPARTMENTS.find(d => d.id === 'transport')?.multiplierValue || 1)
        : 1;

      // Milestone logistics bonuses already in collectEffects

      return base * techMult * deptMult;
    },

    /**
     * Tower multiplier — product of all active department multipliers
     * that are of type 'global', 'industry', etc.
     * Department type 'prestige' handled separately.
     * Also applies Planner and Milestone dept_mult bonuses.
     */
    towerMult() {
      let mult = 1;
      const deptBonus = Math_.collectEffects('dept_mult');

      DEPARTMENTS.forEach(dept => {
        if (!G.departments[dept.id]) return;
        if (['global', 'research', 'logistics'].includes(dept.multiplierType)) {
          // 'global' type applies here; others in their own paths
          if (dept.multiplierType === 'global') {
            mult *= (dept.multiplierValue || 1) * deptBonus;
          }
        }
        // OGAS applies its full multiplier
        if (dept.id === 'ogas') {
          mult *= (dept.multiplierValue || 1);
        }
      });

      return mult;
    },

    /**
     * Global multiplier from techs + milestones + planners
     * (the global_mult effect type).
     */
    globalMult() {
      return Math_.collectEffects('global_mult');
    },

    /**
     * Organized Data generated per second from all active generators
     * and the active logistics tier bonus.
     */
    odPerSecond() {
      let base = 0;
      GENERATORS.forEach(gen => {
        const owned = G.generators[gen.id]?.owned || 0;
        if (owned === 0) return;
        base += (gen.odRate || 0) * owned;
      });
      // Logistics does NOT multiply OD — better transport doesn't make data harder to process.
      // (The original logistics odBonus was the primary cause of late-game imbalance.)
      return base;
    },

    /**
     * Information Processing Capacity generated per second
     * from all computing rooms installed in the tower.
     */
    ipcPerSecond() {
      let total = 0;
      COMPUTING_ROOMS.forEach(room => {
        const count = G.computingRooms[room.id]?.count || 0;
        if (count > 0) total += room.ipcPerRoom * count;
      });
      return total;
    },

    /**
     * Planning Efficiency — the ratio of IPC to OD.
     * Returns a multiplier for GDP/s and RP/s.
     *
     * Ratio = IPC / max(OD, 1)
     *   ratio >= 2.0  → big surplus bonus  (up to ×3.0 on RP)
     *   ratio  1.0–2  → mild surplus bonus
     *   ratio  0.5–1  → neutral / small debuff
     *   ratio < 0.5   → serious deficit    (down to ×0.2 on RP)
     *
     * GDP mult capped at ×2.5 / floored at ×0.5
     * RP  mult capped at ×3.0 / floored at ×0.1
     */
    planningEfficiency() {
      // Compare live rates, not stored totals.
      // This gives ongoing tension: buying new generators raises OD/s immediately;
      // player must invest in rooms to keep pace.
      const odRate  = Math.max(Math_.odPerSecond(),  0.001);
      const ipcRate = Math.max(Math_.ipcPerSecond(), 0);
      const ratio   = ipcRate / odRate;

      let gdpMult, rpMult;
      if (ratio >= 2.0) {
        // Large surplus: great planning bonus
        gdpMult = Math.min(1 + (ratio - 1) * 0.3, 2.5);
        rpMult  = Math.min(1 + (ratio - 1) * 0.8, 3.0);
      } else if (ratio >= 1.0) {
        // Mild surplus: slight bonus
        gdpMult = 1 + (ratio - 1) * 0.2;
        rpMult  = 1 + (ratio - 1) * 0.5;
      } else if (ratio >= 0.5) {
        // Near parity: slight deficit
        gdpMult = 0.85 + ratio * 0.15;
        rpMult  = 0.5  + ratio * 0.5;
      } else {
        // Severe deficit: data overwhelms capacity — Gosplan chaos
        gdpMult = Math.max(0.5, 0.7 + ratio * 0.4);
        rpMult  = Math.max(0.1, ratio * 0.8);
      }

      return { gdpMult, rpMult, ratio };
    },

    /**
     * Research Points per second — now gated by planning efficiency.
     */
    rpPerSecond() {
      let base = 0.05; // trickle so tree is always accessible

      // Science Academy
      if (G.departments['science']) {
        const dept = DEPARTMENTS.find(d => d.id === 'science');
        base += (dept?.rpBonus || 0);
      }

      // Finance Dept doubles RP
      if (G.departments['finance']) {
        const dept = DEPARTMENTS.find(d => d.id === 'finance');
        base *= (dept?.multiplierValue || 1);
      }

      // Tech rp_mult effects
      const techMult = Math_.collectEffects('rp_mult');

      // Planning efficiency multiplier (IPC vs OD delta)
      const { rpMult } = Math_.planningEfficiency();

      return base * techMult * rpMult;
    },

    /**
     * Full GDP/s — the number displayed on screen.
     * Now multiplied by planning efficiency (IPC vs OD delta).
     */
    gdpPerSecond() {
      const raw     = Math_.totalRawProduction();
      const logi    = Math_.logisticsMult();
      const tower   = Math_.towerMult();
      const global  = Math_.globalMult();
      const { gdpMult } = Math_.planningEfficiency();
      return raw * logi * tower * global * gdpMult;
    },

    /**
     * Prestige stars earned for a given peak GDP.
     * Formula: floor(log10(peakGDP) - 3), min 0.
     * Every order of magnitude above $1K earns a star.
     */
    calcPrestigeStars(peakGDP) {
      return Math.max(0, Math.floor(Math.log10(Math.max(peakGDP, 1)) - 3));
    },
  };

  // ===========================================================
  //  UNLOCK / GATE CHECKS
  // ===========================================================

  const Unlock = {
    isGenUnlocked(gen) {
      if (gen.requiresTech && !G.techs[gen.requiresTech]) return false;
      return G.totalGDP >= gen.unlockGDP;
    },

    isLogiAvailable(logi) {
      if (logi.always) return true;
      if (G.logistics[logi.id]) return false; // already owned
      if (logi.requires && !G.logistics[logi.requires]) return false;
      if (logi.requiresTech && !G.techs[logi.requiresTech]) return false;
      return true;
    },

    isDeptAvailable(dept) {
      if (G.departments[dept.id]) return false;
      if (dept.requiresDept && !G.departments[dept.requiresDept]) return false;
      if (dept.requiresTech && !G.techs[dept.requiresTech]) return false;
      return true;
    },

    isTechAvailable(tech) {
      if (G.techs[tech.id]) return false;
      if (tech.requires && !G.techs[tech.requires]) return false;
      return true;
    },

    // Check if a tech or logistics unlock makes something newly available
    // Used to fire unlock notifications
    checkNewUnlocks(type, id) {
      const unlocked = [];
      if (type === 'tech') {
        GENERATORS.forEach(g => {
          if (g.requiresTech === id && Unlock.isGenUnlocked(g)) unlocked.push({ kind: 'gen', id: g.id, name: g.name });
        });
        LOGISTICS.forEach(l => {
          if (l.requiresTech === id && !G.logistics[l.id]) unlocked.push({ kind: 'logi', id: l.id, name: l.name });
        });
        DEPARTMENTS.forEach(d => {
          if (d.requiresTech === id && !G.departments[d.id]) unlocked.push({ kind: 'dept', id: d.id, name: d.name });
        });
      }
      return unlocked;
    },
  };

  // ===========================================================
  //  ACTIONS — State Mutations
  // ===========================================================

  const Actions = {

    /**
     * Kickstart — manual GDP injection for new players.
     * Value scales: 5 × 1.2^min(clicks, 20) per click.
     * G.kickstartClicks persists so button value is accurate after reload.
     */
    kickstart() {
      const clicks = G.kickstartClicks || 0;
      const value  = 5 * Math.pow(1.2, Math.min(clicks, 20));
      G.gdp             += value;
      G.totalGDP        += value;
      G.peakGDP          = Math.max(G.peakGDP, G.gdp);
      G.kickstartClicks  = clicks + 1;
      G.stats.gdpEarned += value;
      checkMilestones();
      emit('kickstart', { value, clicks: G.kickstartClicks });
      emit('gdp_change', { gdp: G.gdp, delta: value });
      return { ok: true, value };
    },

    buyGenerator(genId) {
      const gen = GENERATORS.find(g => g.id === genId);
      if (!gen) return { ok: false, msg: 'Unknown generator' };
      if (!Unlock.isGenUnlocked(gen)) return { ok: false, msg: 'Locked' };

      const owned = G.generators[gen.id]?.owned || 0;
      let qty;

      if (G.buyQty === 'max') {
        qty = Math_.genMaxBuy(gen, owned, G.gdp);
        if (qty < 1) return { ok: false, msg: 'Insufficient GDP' };
      } else {
        qty = G.buyQty;
        const cost = Math_.genCost(gen, owned, qty);
        if (G.gdp < cost) {
          // Try max affordable
          qty = Math_.genMaxBuy(gen, owned, G.gdp);
          if (qty < 1) return { ok: false, msg: 'Insufficient GDP' };
        }
      }

      const cost = Math_.genCost(gen, owned, qty);
      G.gdp -= cost;
      if (!G.generators[gen.id]) G.generators[gen.id] = { owned: 0 };
      G.generators[gen.id].owned += qty;
      G.stats.generatorsBought += qty;

      emit('gen_bought', { id: genId, qty, owned: G.generators[gen.id].owned });
      emit('gdp_change', { gdp: G.gdp, delta: -cost });
      return { ok: true, qty, cost };
    },

    buyLogistics(logiId) {
      const logi = LOGISTICS.find(l => l.id === logiId);
      if (!logi) return { ok: false, msg: 'Unknown logistics' };
      if (G.logistics[logiId]) return { ok: false, msg: 'Already unlocked' };
      if (!Unlock.isLogiAvailable(logi)) return { ok: false, msg: 'Prerequisites not met' };
      if (G.gdp < logi.cost) return { ok: false, msg: 'Insufficient GDP' };

      G.gdp -= logi.cost;
      G.logistics[logiId] = true;
      G.stats.logisticsUnlocked++;

      emit('logi_unlocked', { id: logiId, name: logi.name });
      emit('gdp_change', { gdp: G.gdp, delta: -logi.cost });
      emit('notify', { msg: `✅ ${logi.name} operational!`, type: 'success' });
      return { ok: true };
    },

    buyDepartment(deptId) {
      const dept = DEPARTMENTS.find(d => d.id === deptId);
      if (!dept) return { ok: false, msg: 'Unknown department' };
      if (G.departments[deptId]) return { ok: false, msg: 'Already built' };
      if (!Unlock.isDeptAvailable(dept)) return { ok: false, msg: 'Prerequisites not met' };
      if (G.gdp < dept.cost) return { ok: false, msg: 'Insufficient GDP' };

      G.gdp -= dept.cost;
      G.departments[deptId] = true;
      G.stats.deptsBuilt++;

      if (dept.enablesPrestige) {
        emit('notify', { msg: '🌐 OGAS ONLINE — Five-Year Plan cycle now available!', type: 'prestige' });
      } else {
        emit('notify', { msg: `🏢 ${dept.name} established on Floor ${dept.floor}!`, type: 'success' });
      }

      emit('dept_built', { id: deptId, floor: dept.floor });
      emit('gdp_change', { gdp: G.gdp, delta: -dept.cost });
      return { ok: true };
    },

    buyTech(techId) {
      const tech = TECHS.find(t => t.id === techId);
      if (!tech) return { ok: false, msg: 'Unknown tech' };
      if (G.techs[techId]) return { ok: false, msg: 'Already researched' };
      if (!Unlock.isTechAvailable(tech)) return { ok: false, msg: 'Prerequisites not met' };
      if (G.rp < tech.cost) return { ok: false, msg: 'Insufficient Research Points' };

      G.rp -= tech.cost;
      G.techs[techId] = true;
      G.stats.techsResearched++;

      // Apply any unlock effects immediately
      (tech.effects || []).forEach(e => {
        if (e.type === 'unlock') {
          // Check what category
          const isLogi = LOGISTICS.find(l => l.id === e.target);
          const isDept = DEPARTMENTS.find(d => d.id === e.target);
          if (isLogi) {
            emit('notify', { msg: `🔓 ${isLogi.name} now available for purchase!`, type: 'unlock' });
          } else if (isDept) {
            emit('notify', { msg: `🔓 ${isDept.name} now available for construction!`, type: 'unlock' });
          } else {
            const isGen = GENERATORS.find(g => g.id === e.target);
            if (isGen) emit('notify', { msg: `🔓 ${isGen.name} unlocked!`, type: 'unlock' });
          }
        }
      });

      emit('tech_researched', { id: techId, name: tech.name });
      emit('notify', { msg: `🔬 Researched: ${tech.name}`, type: 'research' });
      return { ok: true };
    },

    setBuyQty(qty) {
      G.buyQty = qty;
    },

    buyComputingRoom(roomId) {
      const room = COMPUTING_ROOMS.find(r => r.id === roomId);
      if (!room) return { ok: false, msg: 'Unknown room' };
      if (room.requiresTech && !G.techs[room.requiresTech]) return { ok: false, msg: 'Tech not researched' };
      if (G.totalGDP < room.unlockGDP) return { ok: false, msg: 'Not yet unlocked' };

      const current = G.computingRooms[roomId]?.count || 0;
      if (current >= room.roomsMax) return { ok: false, msg: 'Room capacity full' };

      const qty   = G.buyQty === 'max'
        ? Math.min(room.roomsMax - current, Math.floor(G.gdp / room.cost))
        : Math.min(G.buyQty, room.roomsMax - current);
      const cost  = room.cost * Math.max(1, qty);

      if (G.gdp < cost || qty < 1) return { ok: false, msg: 'Insufficient GDP' };

      G.gdp -= cost;
      if (!G.computingRooms[roomId]) G.computingRooms[roomId] = { count: 0 };
      G.computingRooms[roomId].count += qty;

      emit('room_bought', { id: roomId, qty, count: G.computingRooms[roomId].count });
      emit('notify', {
        msg: `🖥️ ${room.name}: ${qty} room${qty > 1 ? 's' : ''} installed (+${(room.ipcPerRoom * qty).toFixed(0)} IPC/s)`,
        type: 'success',
      });
      return { ok: true, qty, cost };
    },

    /**
     * Initiate a prestige reset (Five-Year Plan).
     * Requires OGAS department to be active.
     */
    prestige() {
      if (!G.departments['ogas']) return { ok: false, msg: 'OGAS not operational' };

      const stars = Math_.calcPrestigeStars(G.peakGDP);
      if (stars < 1) return { ok: false, msg: 'Insufficient GDP for Planning Stars' };

      G.planningStars += stars;
      G.totalPrestiges++;
      G.bestRun = Math.max(G.bestRun, G.peakGDP);
      G.stats.prestigeCount++;

      // Check for new planner unlocks
      const newPlanners = [];
      PLANNERS.forEach(p => {
        if (!G.planners.includes(p.id) && G.planningStars >= p.starsRequired) {
          G.planners.push(p.id);
          newPlanners.push(p);
        }
      });

      // Preserve across reset
      // Note: techs, rp, totalRP, od, ipc reset — research and data start fresh
      const carry = {
        _version:       SCHEMA_VERSION,
        planningStars:  G.planningStars,
        planners:       G.planners,
        milestones:     G.milestones,
        totalPrestiges: G.totalPrestiges,
        bestRun:        G.bestRun,
        totalGDP:       G.totalGDP,
        totalPlaytime:  G.totalPlaytime,
        totalOD:        G.totalOD,
        totalIPC:       G.totalIPC,
        stats:          G.stats,
      };

      G = Object.assign(createDefaultState(), carry);
      G.lastTick = Date.now();

      Save.save();

      emit('prestige', { stars, total: G.planningStars, newPlanners });
      emit('notify', { msg: `★ NEW FIVE-YEAR PLAN — ${stars} Stars earned!`, type: 'prestige' });

      newPlanners.forEach(p => {
        emit('planner_unlock', { id: p.id, name: p.name });
        emit('notify', { msg: `📋 NEW PLANNER UNLOCKED: ${p.name}!`, type: 'prestige' });
      });

      return { ok: true, stars, newPlanners };
    },

    /**
     * Preview what a prestige would yield (no mutation).
     */
    prestigePreview() {
      const stars = Math_.calcPrestigeStars(G.peakGDP);
      const totalAfter = G.planningStars + stars;
      const newPlanners = PLANNERS.filter(
        p => !G.planners.includes(p.id) && totalAfter >= p.starsRequired
      );
      return { stars, totalAfter, newPlanners, canPrestige: G.departments['ogas'] && stars >= 1 };
    },
  };

  // ===========================================================
  //  MILESTONE CHECK
  // ===========================================================

  function checkMilestones() {
    MILESTONES.forEach(ms => {
      if (!G.milestones[ms.id] && G.totalGDP >= ms.threshold) {
        G.milestones[ms.id] = true;
        emit('milestone', { id: ms.id, name: ms.name, reward: ms.reward });
        emit('notify', { msg: `🏅 ACHIEVEMENT: ${ms.name} — ${ms.reward}`, type: 'milestone' });
      }
    });
  }

  // ===========================================================
  //  SAVE / LOAD
  // ===========================================================

  const Save = {

    save() {
      try {
        G.lastSave = Date.now();
        localStorage.setItem(SAVE_KEY, JSON.stringify(G));
        emit('save', {});
      } catch (e) {
        console.warn('[EPTT Save] Failed to save:', e);
      }
    },

    load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return false;

        // Schema migration
        const loaded = Save._migrate(parsed);

        // Calculate offline progress
        const now = Date.now();
        const offlineMs = Math.max(0, now - (loaded.lastTick || now));
        const offlineSec = Math.min(offlineMs / 1000, OFFLINE_CAP);

        G = Object.assign(createDefaultState(), loaded);
        G.lastTick = now;
        G.lastSave = now;

        // Apply offline earnings
        if (offlineSec > 1) {
          const gdps = Math_.gdpPerSecond();
          const rps  = Math_.rpPerSecond();
          const ods  = Math_.odPerSecond();
          const ipcs = Math_.ipcPerSecond();
          const offlineGDP = gdps * offlineSec;
          const offlineRP  = rps  * offlineSec;
          const offlineOD  = ods  * offlineSec;
          const offlineIPC = ipcs * offlineSec;

          G.gdp      += offlineGDP;
          G.totalGDP += offlineGDP;
          G.peakGDP   = Math.max(G.peakGDP, G.gdp);
          G.rp       += offlineRP;
          G.totalRP  += offlineRP;
          G.od       += offlineOD;
          G.totalOD  += offlineOD;
          G.ipc      += offlineIPC;
          G.totalIPC += offlineIPC;
          G.totalPlaytime += offlineSec;
          G.stats.gdpEarned += offlineGDP;

          checkMilestones();

          emit('load', { offlineSeconds: offlineSec, offlineGDP, offlineRP });
          emit('notify', {
            msg: `📅 Welcome back! ${fmt(offlineSec / 3600, 1)}h offline. Earned ${fmtGDP(offlineGDP)}.`,
            type: 'info',
          });
        } else {
          emit('load', { offlineSeconds: 0, offlineGDP: 0, offlineRP: 0 });
        }

        return true;
      } catch (e) {
        console.warn('[EPTT Load] Failed to load save:', e);
        return false;
      }
    },

    _migrate(data) {
      if (!data._version || data._version < 2) {
        data._version = 2;
        if (!data.stats) data.stats = createDefaultState().stats;
        if (!data.totalPlaytime) data.totalPlaytime = 0;
        if (!data.bestRun) data.bestRun = 0;
        if (!data.totalRP) data.totalRP = 0;
      }
      if (data._version < 3) {
        data._version = 3;
        data.od  = data.od  || 0;
        data.ipc = data.ipc || 0;
        data.totalOD  = data.totalOD  || 0;
        data.totalIPC = data.totalIPC || 0;
        data.computingRooms = data.computingRooms || {};
      }
      return data;
    },

    reset() {
      localStorage.removeItem(SAVE_KEY);
      G = createDefaultState();
      emit('notify', { msg: '⚠️ Save data cleared. New game started.', type: 'warning' });
    },

    export() {
      return btoa(JSON.stringify(G));
    },

    import(str) {
      try {
        const parsed = JSON.parse(atob(str));
        const migrated = Save._migrate(parsed);
        G = Object.assign(createDefaultState(), migrated);
        emit('notify', { msg: '✅ Save imported successfully!', type: 'success' });
        return true;
      } catch (e) {
        emit('notify', { msg: '❌ Import failed: invalid save data.', type: 'error' });
        return false;
      }
    },
  };

  // ===========================================================
  //  TICK — Main Game Loop
  // ===========================================================

  let _tickInterval = null;
  let _saveInterval = null;

  function tick() {
    const now = Date.now();
    const dt  = Math.min((now - G.lastTick) / 1000, OFFLINE_CAP);
    G.lastTick = now;

    if (dt <= 0) return;

    const gdps = Math_.gdpPerSecond();
    const rps  = Math_.rpPerSecond();
    const ods  = Math_.odPerSecond();
    const ipcs = Math_.ipcPerSecond();

    const earnedGDP = gdps * dt;
    const earnedRP  = rps  * dt;
    const earnedOD  = ods  * dt;
    const earnedIPC = ipcs * dt;

    G.gdp       += earnedGDP;
    G.totalGDP  += earnedGDP;
    G.peakGDP    = Math.max(G.peakGDP, G.gdp);
    G.rp        += earnedRP;
    G.totalRP   += earnedRP;
    G.od        += earnedOD;
    G.totalOD   += earnedOD;
    G.ipc       += earnedIPC;
    G.totalIPC  += earnedIPC;
    G.totalPlaytime += dt;
    G.stats.gdpEarned += earnedGDP;

    checkMilestones();

    emit('tick', { gdps, rps, ods, ipcs, dt, gdp: G.gdp, rp: G.rp, od: G.od, ipc: G.ipc });
  }

  // ===========================================================
  //  NUMBER FORMATTING
  // ===========================================================

  const SUFFIXES = [
    [1e33, 'Dc'], [1e30, 'No'], [1e27, 'Oc'], [1e24, 'Sp'],
    [1e21, 'Sx'], [1e18, 'Qi'], [1e15, 'Qa'], [1e12, 'T'],
    [1e9,  'B'],  [1e6,  'M'], [1e3,  'K'],
  ];

  function fmt(n, decimals = 2) {
    if (!isFinite(n)) return '∞';
    if (n === 0) return '0';
    const abs = Math.abs(n);
    for (const [val, suf] of SUFFIXES) {
      if (abs >= val) return (n / val).toFixed(decimals) + suf;
    }
    return n.toFixed(decimals);
  }

  function fmtGDP(n, decimals = 2)   { return '$' + fmt(n, decimals); }
  function fmtRP(n)                  { return Math.floor(n).toLocaleString() + ' RP'; }
  function fmtTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0)  return `${h}h ${m}m`;
    if (m > 0)  return `${m}m ${s}s`;
    return `${s}s`;
  }

  // ===========================================================
  //  QUERY API
  //  Read-only computed views for the UI layer.
  // ===========================================================

  const Query = {
    // --- State ---
    getGDP()          { return G.gdp; },
    getTotalGDP()     { return G.totalGDP; },
    getPeakGDP()      { return G.peakGDP; },
    getRP()           { return G.rp; },
    getOD()           { return G.od; },
    getIPC()          { return G.ipc; },
    getPlanningStars(){ return G.planningStars; },
    getTotalPrestiges(){ return G.totalPrestiges; },
    getBuyQty()       { return G.buyQty; },
    getStats()        { return { ...G.stats }; },
    getPlaytime()     { return G.totalPlaytime; },

    // --- Rates ---
    getGDPS()         { return Math_.gdpPerSecond(); },
    getRPS()          { return Math_.rpPerSecond(); },
    getODS()          { return Math_.odPerSecond(); },
    getIPCS()         { return Math_.ipcPerSecond(); },
    getPlanningEff()  { return Math_.planningEfficiency(); },
    getLogisticsMult(){ return Math_.logisticsMult(); },
    getTowerMult()    { return Math_.towerMult(); },
    getGlobalMult()   { return Math_.globalMult(); },

    // --- Generators ---
    getGenerators() {
      return GENERATORS.map(gen => {
        const owned    = G.generators[gen.id]?.owned || 0;
        const unlocked = Unlock.isGenUnlocked(gen);
        const qty      = G.buyQty === 'max'
          ? Math.max(1, Math_.genMaxBuy(gen, owned, G.gdp))
          : G.buyQty;
        const cost     = Math_.genCost(gen, owned, Math.max(1, qty));
        const maxBuy   = Math_.genMaxBuy(gen, owned, G.gdp);
        const prod     = Math_.genProduction(gen);

        return {
          ...gen,
          owned, unlocked, cost, qty, maxBuy, prod,
          affordable: G.gdp >= cost && unlocked,
          costNext: Math_.genCost(gen, owned, 1),
        };
      });
    },

    getGenerator(id) {
      const gen = GENERATORS.find(g => g.id === id);
      if (!gen) return null;
      const owned    = G.generators[id]?.owned || 0;
      const unlocked = Unlock.isGenUnlocked(gen);
      const qty      = G.buyQty === 'max'
        ? Math.max(1, Math_.genMaxBuy(gen, owned, G.gdp))
        : G.buyQty;
      const cost     = Math_.genCost(gen, owned, Math.max(1, qty));
      return { ...gen, owned, unlocked, cost, qty, prod: Math_.genProduction(gen) };
    },

    // --- Logistics ---
    getLogistics() {
      return LOGISTICS.map(l => ({
        ...l,
        unlocked:   !!G.logistics[l.id],
        available:  Unlock.isLogiAvailable(l),
        affordable: G.gdp >= l.cost && Unlock.isLogiAvailable(l),
      }));
    },

    // --- Departments ---
    getDepartments() {
      return DEPARTMENTS.map(d => ({
        ...d,
        built:     !!G.departments[d.id],
        available: Unlock.isDeptAvailable(d),
        affordable: G.gdp >= d.cost && Unlock.isDeptAvailable(d),
      }));
    },

    // --- Techs ---
    getTechs() {
      return TECHS.map(t => ({
        ...t,
        researched: !!G.techs[t.id],
        available:  Unlock.isTechAvailable(t),
        affordable: G.rp >= t.cost && Unlock.isTechAvailable(t),
      }));
    },

    // --- Milestones ---
    getMilestones() {
      return MILESTONES.map(ms => ({
        ...ms,
        achieved: !!G.milestones[ms.id],
        progress: Math.min(G.totalGDP / ms.threshold, 1),
      }));
    },

    // --- Planners ---
    getPlanners() {
      return PLANNERS.map(p => ({
        ...p,
        unlocked: G.planners.includes(p.id),
      }));
    },

    // --- Prestige Preview ---
    getPrestigePreview() { return Actions.prestigePreview(); },

    // --- Map Data (Phase 3 hook) ---
    getMapData() {
      // Returns a structured snapshot for the map renderer
      const cityCount  = Object.values(G.generators)
        .reduce((sum, gs) => sum + (gs?.owned || 0), 0);
      const industries = GENERATORS
        .filter(g => (G.generators[g.id]?.owned || 0) > 0)
        .map(g => ({
          id:      g.id,
          sprite:  g.mapSprite,
          owned:   G.generators[g.id].owned,
          weight:  g.cityWeight || 0,
        }));
      const logiLevel = LOGISTICS.filter(l => G.logistics[l.id]).length - 1;

      return {
        cityCount,
        industries,
        logiLevel,
        mapFeatures: LOGISTICS
          .filter(l => G.logistics[l.id] && l.mapFeature)
          .map(l => l.mapFeature),
        gdp:     G.gdp,
        gdps:    Math_.gdpPerSecond(),
      };
    },

    // --- Tower Data (Phase 2 hook) ---
    getTowerData() {
      return DEPARTMENTS.map(d => ({
        ...d,
        built: !!G.departments[d.id],
      })).sort((a, b) => a.floor - b.floor);
    },

    // --- Ticker (gated — only return messages whose requirements are met) ---
    getTickerMessages() {
      return TICKER_MSGS
        .filter(msg => {
          if (!msg.req || msg.req.length === 0) return true;
          return msg.req.every(r => {
            if (r.t === 'gen')       return (G.generators[r.id]?.owned || 0) > 0;
            if (r.t === 'logi')      return !!G.logistics[r.id];
            if (r.t === 'dept')      return !!G.departments[r.id];
            if (r.t === 'tech')      return !!G.techs[r.id];
            if (r.t === 'milestone') return !!G.milestones[r.id];
            return false;
          });
        })
        .map(msg => msg.text);
    },

    // --- Kickstart ---
    getKickstartValue() {
      const clicks = G.kickstartClicks || 0;
      return 5 * Math.pow(1.2, Math.min(clicks, 20));
    },
    getKickstartClicks() { return G.kickstartClicks || 0; },

    // --- Computing Rooms ---
    getComputingRooms() {
      return COMPUTING_ROOMS.map(r => {
        const count   = G.computingRooms[r.id]?.count || 0;
        const unlocked = (!r.requiresTech || G.techs[r.requiresTech]) && G.totalGDP >= r.unlockGDP;
        const cost    = r.cost;
        const full    = count >= r.roomsMax;
        const affordable = G.gdp >= cost && unlocked && !full;
        return { ...r, count, unlocked, cost, affordable, full, ipcTotal: r.ipcPerRoom * count };
      });
    },

    // --- Formatting helpers exposed to UI ---
    fmt, fmtGDP, fmtRP, fmtTime,
  };

  // ===========================================================
  //  INIT
  // ===========================================================

  function init() {
    const loaded = Save.load();
    if (!loaded) {
      G = createDefaultState();
      emit('notify', { msg: '★ Welcome to EconPlanTowerTycoon!', type: 'info' });
    }

    _tickInterval = setInterval(tick, TICK_INTERVAL);
    _saveInterval = setInterval(() => Save.save(), SAVE_INTERVAL);

    global.addEventListener('beforeunload', () => Save.save());

    console.log(
      '%c EconPlanTowerTycoon %c game.js loaded ',
      'background:#c0392b;color:#f1c40f;font-weight:bold;padding:3px 6px',
      'background:#1a120c;color:#fdf6e3;padding:3px 6px',
    );
    console.log('[EPTT] Math engine ready. GDP/s:', Math_.gdpPerSecond().toFixed(4));
  }

  function destroy() {
    clearInterval(_tickInterval);
    clearInterval(_saveInterval);
    Save.save();
  }

  // ===========================================================
  //  PUBLIC API  —  window.EPTT
  // ===========================================================

  global.EPTT = {
    // Core actions
    buy:              Actions.buyGenerator,
    buyLogistics:     Actions.buyLogistics,
    buyDept:          Actions.buyDepartment,
    research:         Actions.buyTech,
    setBuyQty:        Actions.setBuyQty,
    prestige:         Actions.prestige,
    kickstart:        Actions.kickstart,
    buyRoom:          Actions.buyComputingRoom,

    // Events
    on,
    off,
    emit,

    // Queries (read-only)
    q: Query,

    // Save
    save:         Save.save,
    load:         Save.load,
    reset:        Save.reset,
    exportSave:   Save.export,
    importSave:   Save.import,

    // Formatting
    fmt, fmtGDP, fmtRP, fmtTime,

    // Data tables (read-only references)
    data: {
      GENERATORS,
      LOGISTICS,
      DEPARTMENTS,
      TECHS,
      MILESTONES,
      PLANNERS,
      TICKER_MSGS,
      COMPUTING_ROOMS,
    },

    // Internals exposed for debugging
    _state:  () => G,
    _math:   Math_,
    _unlock: Unlock,

    // Lifecycle
    init,
    destroy,
  };

})(window);
