// --- IndexedDB Client-Side Database Layer ---
const DB_NAME = 'KairosDB';
const DB_VERSION = 1;
const STORE_NAME = 'onboarding_sessions';

let dbInstance = null;

function initDatabase() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB open request error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function saveSession(sessionData) {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      reject(new Error('Database not initialized.'));
      return;
    }

    const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const dataToSave = JSON.parse(JSON.stringify(sessionData));
    const request = store.put(dataToSave);

    request.onsuccess = () => {
      resolve(sessionData.id);
    };

    request.onerror = (event) => {
      console.error('Failed to save session:', event.target.error);
      reject(event.target.error);
    };
  });
}

function getSessions() {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      reject(new Error('Database not initialized.'));
      return;
    }

    const transaction = dbInstance.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const sessions = request.result || [];
      sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      resolve(sessions);
    };

    request.onerror = (event) => {
      console.error('Failed to retrieve sessions:', event.target.error);
      reject(event.target.error);
    };
  });
}

function clearDatabase() {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      reject(new Error('Database not initialized.'));
      return;
    }

    const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = (event) => {
      console.error('Failed to clear database:', event.target.error);
      reject(event.target.error);
    };
  });
}

// --- Global Application State ---
const state = {
  // Navigation & Queue
  currentStepIndex: 0,
  activeQueue: [], // Populated dynamically: ['welcome', 'basic_info', 'life_state', 'focus_areas', ..., 'final_roadmap']
  
  // Collected Answers Data
  sessionData: {
    id: '',
    timestamp: '',
    basic_info: {
      first_name: '',
      age: 25,
      gender: '',
      country: '',
      occupation: '',
      relationship_status: '',
      activity_level: ''
    },
    life_state: '',
    focus_areas: [],
    flow_responses: {},
    general_responses: {},
    generated_roadmap: {}
  },
  
  // Active Question Definition
  activeNode: null
};

// --- Universal Question Node Database & Flow Dictionary ---
const ALL_FLOW_NODES = {
  // 1. WELCOME / SIGN IN (Universal)
  welcome: {
    type: 'custom',
    render: renderWelcomeScreen
  },
  
  // 2. BASIC INFO FORM (Universal)
  basic_info: {
    type: 'custom',
    title: 'Tell us a little about yourself.',
    subtitle: 'We tailor the experience to your daily context.',
    render: renderBasicInfoForm,
    validate: validateBasicInfoForm
  },
  
  // 3. CURRENT LIFE STATE (Universal — multiple selection)
  life_state: {
    type: 'multiple',
    title: 'How would you describe your life right now?',
    subtitle: 'Select everything that resonates. This is a judgment-free zone.',
    options: [
      { id: 'okay_better', text: 'I’m doing okay, but I know I can become much better.', desc: 'You have a solid foundation and are ready to unlock the next level of growth.', icon: 'sparkles' },
      { id: 'stuck_structure', text: 'I feel stuck and need structure in my life.', desc: 'We will construct a clear path to break through your current plateaus.', icon: 'compass' },
      { id: 'lost_consistency', text: 'I’ve lost consistency and motivation lately.', desc: 'Let us reignite your drive and establish unbreakable daily habits.', icon: 'battery-low' },
      { id: 'improve_seriously', text: 'I want to improve myself seriously and reach my potential.', desc: 'A high-performance trajectory designed for ultimate success.', icon: 'trending-up' },
      { id: 'exhausted', text: 'I feel overwhelmed and mentally exhausted.', desc: 'We will prioritize peace, recovery, and steady, gentle progress.', icon: 'wind' },
      { id: 'level_up', text: 'I already have discipline, but I want to level up.', desc: 'Fine-tuning your systems for peak optimization and mastery.', icon: 'shield' }
    ],
    save: (vals) => { state.sessionData.life_state = vals; }
  },
  
  // 4. AREAS OF ATTENTION (Universal - Dynamic Branching Trigger)
  focus_areas: {
    type: 'multiple',
    title: 'Which areas of your life need the most attention right now?',
    subtitle: 'Select all that apply. We will dynamically build your custom flows.',
    options: [
      { id: 'physical_health', text: 'Physical Health & Fitness', desc: 'Strength, stamina, nutrition, and exercise consistency.', icon: 'activity' },
      { id: 'mental_health', text: 'Mental Health & Inner Peace', desc: 'Mindfulness, anxiety reduction, stress relief, and calm.', icon: 'heart' },
      { id: 'focus_productivity', text: 'Focus & Productivity', desc: 'Time management, flow states, and work optimization.', icon: 'zap' },
      { id: 'discipline_consistency', text: 'Discipline & Consistency', desc: 'Building unbreakable habits and killing procrastination.', icon: 'lock' },
      { id: 'education_learning', text: 'Education & Learning', desc: 'Skill acquisition, reading routines, and cognitive growth.', icon: 'book-open' },
      { id: 'relationships', text: 'Relationships & Social Life', desc: 'Family bonds, deep friendships, communication, and self-love.', icon: 'users' },
      { id: 'confidence_esteem', text: 'Confidence & Self-Esteem', desc: 'Imposter syndrome, body image, public presence, and voice.', icon: 'smile' },
      { id: 'career_finance', text: 'Career & Financial Growth', desc: 'Goal mapping, salary progression, budgeting, and focus.', icon: 'dollar-sign' },
      { id: 'sleep_energy', text: 'Sleep & Energy', desc: 'Circadian rhythm, deep rest, wake routines, and daily fuel.', icon: 'moon' },
      { id: 'motivation_purpose', text: 'Motivation & Purpose', desc: 'Finding your calling, setting vision, and driving energy.', icon: 'target' }
    ],
    save: (vals) => {
      state.sessionData.focus_areas = vals;
      buildDynamicQueue();
    }
  },
  
  // 5. HEALTH & FITNESS FLOW
  fitness_lifestyle: {
    type: 'single',
    title: 'What best describes your current fitness lifestyle?',
    subtitle: 'No shame. Every journey starts exactly where you are.',
    options: [
      { id: 'fit_gym_consistent', text: 'I go to the gym consistently', desc: 'Active routine established, looking for optimization.', icon: 'check-circle' },
      { id: 'fit_workout_occasion', text: 'I work out occasionally', desc: 'Some movement, but lacks a strict scheduling structure.', icon: 'award' },
      { id: 'fit_struggle_consistent', text: 'I want to start but struggle to stay consistent', desc: 'High intent, but constant cycle of quitting.', icon: 'rotate-cw' },
      { id: 'fit_rare_exercise', text: 'I rarely exercise', desc: 'Sedentary style, need simple starting steps.', icon: 'compass' },
      { id: 'fit_neglected', text: 'I’ve completely neglected my fitness lately', desc: 'Ready for a total physical reset and routine reboot.', icon: 'alert-triangle' }
    ],
    save: (val) => { state.sessionData.flow_responses.fitness_lifestyle = val; }
  },
  fitness_goal: {
    type: 'single',
    title: 'What is your primary fitness goal?',
    subtitle: 'This centers your workout roadmap objectives.',
    options: [
      { id: 'fit_goal_lose_weight', text: 'Lose weight', desc: 'Fat loss, healthy conditioning, and body definition.', icon: 'flame' },
      { id: 'fit_goal_build_muscle', text: 'Build muscle', desc: 'Strength enlargement, athletic volume, and resistance.', icon: 'dumbbell' },
      { id: 'fit_goal_healthy', text: 'Become healthier', desc: 'Cardiovascular longevity, joint health, and biological vigor.', icon: 'heart' },
      { id: 'fit_goal_stamina', text: 'Improve stamina and energy', desc: 'Crushing mid-day slumps and scaling athletic tolerance.', icon: 'battery-charging' },
      { id: 'fit_goal_confident', text: 'Feel more confident physically', desc: 'Improving body posture, presence, and overall self-image.', icon: 'eye' },
      { id: 'fit_goal_discipline', text: 'Build discipline through fitness', desc: 'Using physical suffering to build an unbreakable mind.', icon: 'shield' }
    ],
    save: (val) => { state.sessionData.flow_responses.fitness_goal = val; }
  },
  fitness_obstacle: {
    type: 'single',
    title: 'What usually stops you from reaching your fitness goals?',
    subtitle: 'Pinpointing the friction allows us to neutralize it.',
    options: [
      { id: 'fit_obs_motivation', text: 'Lack of motivation', desc: 'Relying on emotional spikes rather than systematic habits.', icon: 'help-circle' },
      { id: 'fit_obs_inconsistent', text: 'Inconsistent routine', desc: 'Life interrupts schedule, and training falls off quickly.', icon: 'calendar' },
      { id: 'fit_obs_no_time', text: 'No time', desc: 'Busy career or education blocks energy allocations.', icon: 'clock' },
      { id: 'fit_obs_low_energy', text: 'Low energy', desc: 'Too tired after work to train effectively.', icon: 'battery' },
      { id: 'fit_obs_stress', text: 'Stress or mental exhaustion', desc: 'Mental fatigue causes resistance to physical efforts.', icon: 'frown' },
      { id: 'fit_obs_know_how', text: 'I don’t know where to start', desc: 'Confused by conflicting training guides and diet advice.', icon: 'map' },
      { id: 'fit_obs_quit_early', text: 'I quit after a few days', desc: 'Fast initial hype, followed by an immediate crash.', icon: 'trending-down' },
      { id: 'fit_obs_confidence', text: 'Lack of confidence', desc: 'Gym intimidation or physical insecurity.', icon: 'lock' }
    ],
    save: (val) => { state.sessionData.flow_responses.fitness_obstacle = val; }
  },
  
  // 6. RELATIONSHIPS FLOW
  relationships_target: {
    type: 'multiple',
    title: 'Which relationships would you like to improve?',
    subtitle: 'Select the focus areas of your social ecosystem.',
    options: [
      { id: 'rel_target_parents', text: 'Parents & Family', desc: 'Deepening ancestral connections or healing boundaries.', icon: 'home' },
      { id: 'rel_target_friends', text: 'Friendships', desc: 'Attracting high-value peers or restoring old bonds.', icon: 'users' },
      { id: 'rel_target_romantic', text: 'Romantic / Love Life', desc: 'Dating structure, partnership harmony, or vulnerability.', icon: 'heart' },
      { id: 'rel_target_social', text: 'Social Skills', desc: 'Conversational charisma, public networking, and charm.', icon: 'message-circle' },
      { id: 'rel_target_self', text: 'Relationship with myself', desc: 'Self-compassion, solid boundaries, and inner dialogues.', icon: 'user' }
    ],
    save: (vals) => { state.sessionData.flow_responses.relationships_target = vals; }
  },
  relationships_challenge: {
    type: 'single',
    title: 'What challenges are affecting your relationships most?',
    subtitle: 'Identifying the emotional barrier triggers growth.',
    options: [
      { id: 'rel_chal_loneliness', text: 'Loneliness', desc: 'Surrounded by people but lacking meaningful connection.', icon: 'user-minus' },
      { id: 'rel_chal_overthinking', text: 'Overthinking', desc: 'Analyzing texts, cues, and micro-expressions exhaustively.', icon: 'brain' },
      { id: 'rel_chal_communication', text: 'Poor communication', desc: 'Struggling to express boundaries, needs, or vulnerability.', icon: 'message-square' },
      { id: 'rel_chal_low_confidence', text: 'Low confidence', desc: 'Believing you are not interesting enough to engage others.', icon: 'frown' },
      { id: 'rel_chal_anxiety', text: 'Social anxiety', desc: 'Physical stress and mental static in social settings.', icon: 'alert-circle' },
      { id: 'rel_chal_trust', text: 'Trust issues', desc: 'Guarded by past betrayals, struggling to let people in.', icon: 'shield-off' },
      { id: 'rel_chal_distance', text: 'Emotional distance', desc: 'Detaching from others to protect yourself from pain.', icon: 'minimize' },
      { id: 'rel_chal_meaning', text: 'Lack of meaningful connections', desc: 'Conversations remain shallow, surface-level, and boring.', icon: 'hash' },
      { id: 'rel_chal_judgment', text: 'Fear of judgment', desc: 'Constantly curating actions to satisfy external validation.', icon: 'eye' }
    ],
    save: (val) => { state.sessionData.flow_responses.relationships_challenge = val; }
  },
  
  // 7. EDUCATION & PRODUCTIVITY FLOW
  education_state: {
    type: 'single',
    title: 'What best describes your current situation?',
    subtitle: 'Find your focus baseline.',
    options: [
      { id: 'edu_focus_struggle', text: 'I struggle to stay focused', desc: 'Short attention span, constantly shifting between tabs.', icon: 'alert-triangle' },
      { id: 'edu_procrastinate', text: 'I procrastinate a lot', desc: 'Delaying high-impact tasks until the absolute last minute.', icon: 'clock' },
      { id: 'edu_finish_never', text: 'I start things but never finish', desc: 'High initial activation energy, zero follow-through capability.', icon: 'slash' },
      { id: 'edu_discipline', text: 'I want better study/work discipline', desc: 'Looking for a structured daily system to grind smoothly.', icon: 'shield' },
      { id: 'edu_distracted', text: 'I feel mentally distracted all the time', desc: 'Brain fog, doomscrolling urges, and constant mental static.', icon: 'help-circle' },
      { id: 'edu_highly_prod', text: 'I want to become highly productive', desc: 'Ready to master deep work and build an elite output engine.', icon: 'zap' }
    ],
    save: (val) => { state.sessionData.flow_responses.education_state = val; }
  },
  education_distraction: {
    type: 'single',
    title: 'What distracts you the most?',
    subtitle: 'Neutralizing focus leaks is step one to hyper-productivity.',
    options: [
      { id: 'edu_dist_social', text: 'Social media', desc: 'Endless doomscrolling, notification tracking, and feed updates.', icon: 'smartphone' },
      { id: 'edu_dist_overthinking', text: 'Overthinking', desc: 'Internal narratives and future anxiety paralyzing action.', icon: 'brain' },
      { id: 'edu_dist_gaming', text: 'Gaming', desc: 'Chasing digital dopamine hits rather than real-world wins.', icon: 'gamepad' },
      { id: 'edu_dist_laziness', text: 'Laziness', desc: 'Lack of initial physical activation energy to start tasks.', icon: 'coffee' },
      { id: 'edu_dist_burnout', text: 'Burnout', desc: 'Complete depletion of cognitive batteries and passion.', icon: 'flame' },
      { id: 'edu_dist_structure', text: 'Lack of structure', desc: 'No daily schedule, resulting in aimless time usage.', icon: 'compass' },
      { id: 'edu_dist_sleep', text: 'Poor sleep', desc: 'Waking up exhausted, destroying early morning focus blocks.', icon: 'moon' },
      { id: 'edu_dist_motivation', text: 'Low motivation', desc: 'Not caring enough about the task to allocate energy.', icon: 'battery' }
    ],
    save: (val) => { state.sessionData.flow_responses.education_distraction = val; }
  },
  
  // 8. DISCIPLINE & MOTIVATION FLOW
  discipline_state: {
    type: 'single',
    title: 'What feels most true about you right now?',
    subtitle: 'Your relationship with consistency dictates your future.',
    options: [
      { id: 'disc_state_basic_habits', text: 'I struggle with even basic habits', desc: 'Struggling with waking up, cleaning, hydration, or reading.', icon: 'frown' },
      { id: 'disc_state_few_days', text: 'I can stay consistent for a few days only', desc: 'The typical 3-day motivational burst followed by collapse.', icon: 'rotate-cw' },
      { id: 'disc_state_lack_structure', text: 'I want discipline but lack structure', desc: 'High drive, but running in circles with no systematic routine.', icon: 'compass' },
      { id: 'disc_state_somewhat', text: 'I’m somewhat disciplined already', desc: 'Solid base habits, but seeking peak optimization strategies.', icon: 'award' },
      { id: 'disc_state_elite', text: 'I want an elite-level self-improvement system', desc: 'Ready to build a rigorous, military-grade life operating system.', icon: 'shield' }
    ],
    save: (val) => { state.sessionData.flow_responses.discipline_state = val; }
  },
  discipline_motivation: {
    type: 'single',
    title: 'What motivates you the most?',
    subtitle: 'Your deepest drive is the fuel for your dark days.',
    options: [
      { id: 'disc_mot_progress', text: 'Seeing visible progress', desc: 'Data logs, physical changes, and system metrics.', icon: 'bar-chart-2' },
      { id: 'disc_mot_stronger', text: 'Becoming mentally stronger', desc: 'Building resilience, stoicism, and emotional sovereignty.', icon: 'activity' },
      { id: 'disc_mot_goals', text: 'Achieving my goals', desc: 'Checking off big objectives and turning dreams into physical assets.', icon: 'target' },
      { id: 'disc_mot_prove_self', text: 'Proving myself to myself', desc: 'Defeating internal shadows and building unshakeable trust.', icon: 'user-check' },
      { id: 'disc_mot_confidence', text: 'Building confidence', desc: 'Unlocking physical presence and emotional social courage.', icon: 'smile' },
      { id: 'disc_mot_respected', text: 'Becoming respected', desc: 'Standing tall in your community and providing value.', icon: 'users' },
      { id: 'disc_mot_escape_mediocrity', text: 'Escaping mediocrity', desc: 'Refusing to live a standard, uninspired, low-discipline life.', icon: 'alert-triangle' },
      { id: 'disc_mot_dream_life', text: 'Creating my dream life', desc: 'Constructing ultimate autonomy, financial freedom, and vitality.', icon: 'sparkles' }
    ],
    save: (val) => { state.sessionData.flow_responses.discipline_motivation = val; }
  },
  
  // 9. SLEEP FLOW
  sleep_state: {
    type: 'single',
    title: 'How has your sleep been recently?',
    subtitle: 'Sleep is the fundamental pillar of human cognition and energy.',
    options: [
      { id: 'slp_good_consistent', text: 'Very good and consistent', desc: 'Waking up refreshed, regular bedtimes.', icon: 'smile' },
      { id: 'slp_decent_inconsistent', text: 'Decent but inconsistent', desc: 'Average sleep, but fluctuates wildly on weekends.', icon: 'meh' },
      { id: 'slp_poor_exhausting', text: 'Poor and exhausting', desc: 'Struggling to fall asleep, waking up completely drained.', icon: 'frown' },
      { id: 'slp_stay_up_late', text: 'I stay up too late often', desc: 'Revenge bedtime procrastination, doomscrolling past midnight.', icon: 'smartphone' },
      { id: 'slp_broken', text: 'My sleep schedule is completely broken', desc: 'Day/night cycle reversed, chaotic sleep blocks.', icon: 'alert-circle' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.sleep_state = val;
      // INTERNAL BRANCHING: If poor or broken sleep, dynamically inject sleep support question next!
      if (val === 'Poor and exhausting' || val === 'My sleep schedule is completely broken' || val === 'I stay up too late often') {
        injectSleepSupportNode();
      }
    }
  },
  sleep_support: {
    type: 'single',
    title: 'Would you like help improving your sleep routine?',
    subtitle: 'We can structure a specialized evening winding-down protocol.',
    options: [
      { id: 'slp_sup_yes', text: 'Yes, definitely', desc: 'Build an optimized pre-sleep wind-down routine for me.', icon: 'check-circle' },
      { id: 'slp_sup_maybe', text: 'Maybe later', desc: 'Keep it general for now, I will configure sleep settings later.', icon: 'help-circle' },
      { id: 'slp_sup_no', text: 'Not right now', desc: 'I prefer to focus on other self-improvement targets first.', icon: 'x-circle' }
    ],
    save: (val) => { state.sessionData.flow_responses.sleep_support = val; }
  },
  
  // 10. EATING HABITS FLOW (Dynamic follow-up if Physical Health is chosen)
  eating_state: {
    type: 'single',
    title: 'How would you describe your eating habits?',
    subtitle: 'Fuel dictates biology, and biology dictates psychology.',
    options: [
      { id: 'eat_very_healthy', text: 'Very healthy and balanced', desc: 'Clean eating, macro tracking, organic hydration.', icon: 'check-circle' },
      { id: 'eat_mostly_healthy', text: 'Mostly healthy', desc: 'Avoid junk food generally, but eat out occasionally.', icon: 'award' },
      { id: 'eat_mixed', text: 'Mixed diet', desc: 'A balance of home-cooked meals and rapid snacks.', icon: 'activity' },
      { id: 'eat_too_much_junk', text: 'Too much junk food', desc: 'Sugar cravings, late-night snacking, heavy processing.', icon: 'alert-triangle' },
      { id: 'eat_no_nutrition', text: 'I barely pay attention to nutrition', desc: 'Eating whatever is fast, cheap, and immediately available.', icon: 'help-circle' }
    ],
    save: (val) => { state.sessionData.flow_responses.eating_state = val; }
  },
  eating_support: {
    type: 'single',
    title: 'Would you like support improving your nutrition habits?',
    subtitle: 'Simple, non-restrictive meal triggers can yield huge energy returns.',
    options: [
      { id: 'eat_sup_yes', text: 'Yes', desc: 'Embed nutrition habits and simple hydration tracking.', icon: 'check-circle' },
      { id: 'eat_sup_maybe', text: 'Maybe later', desc: 'I want to focus solely on physical movements first.', icon: 'help-circle' },
      { id: 'eat_sup_no', text: 'No thanks', desc: 'I have my nutrition fully optimized already.', icon: 'x-circle' }
    ],
    save: (val) => { state.sessionData.flow_responses.eating_support = val; }
  },
  
  // 11. ROUTINE STRUCTURE PAGE (Universal)
  routine: {
    type: 'single',
    title: 'How predictable are your days?',
    subtitle: 'Structure is the container of high performance.',
    options: [
      { id: 'rout_extremely', text: 'Extremely structured', desc: 'Time-blocked hours, exact wake/sleep schedules.', icon: 'calendar' },
      { id: 'rout_somewhat', text: 'Somewhat organized', desc: 'Loose morning routines, basic calendar checkmarks.', icon: 'check-square' },
      { id: 'rout_different', text: 'Different every day', desc: 'Fluctuating schedules, adapting to external requirements.', icon: 'shuffle' },
      { id: 'rout_chaotic', text: 'Completely chaotic', desc: 'No plan, reacting blindly to whatever occurs hourly.', icon: 'alert-triangle' },
      { id: 'rout_almost_no', text: 'I have almost no routine', desc: 'Aimless transitions, massive sleep drifting, highly reactive.', icon: 'compass' }
    ],
    save: (val) => { state.sessionData.general_responses.routine = val; }
  },
  
  // 12. REFLECTION PAGES (Universal)
  reflection_progress: {
    type: 'single',
    title: 'What would progress look like for you?',
    subtitle: 'Define your victory condition. Focus anchors action.',
    options: [
      { id: 'ref_prog_happier', text: 'Feeling happier daily', desc: 'Reducing cortisol spikes, finding organic presence and calm.', icon: 'smile' },
      { id: 'ref_prog_disciplined', text: 'Becoming disciplined', desc: 'Waking up, showing up, doing the work even when you hate it.', icon: 'shield' },
      { id: 'ref_prog_look_better', text: 'Looking better physically', desc: 'Sculpting posture, building athletic composition, lean force.', icon: 'dumbbell' },
      { id: 'ref_prog_more_energy', text: 'Having more energy', desc: 'Waking up clean, feeling stable power and mental clarity.', icon: 'battery-charging' },
      { id: 'ref_prog_peaceful', text: 'Feeling mentally peaceful', desc: 'Silencing overthinking, anchors, and internal anxiety.', icon: 'wind' },
      { id: 'ref_prog_proud', text: 'Being proud of myself', desc: 'Knowing your words and actions are in complete alignment.', icon: 'award' },
      { id: 'ref_prog_relationships', text: 'Building meaningful relationships', desc: 'Cutting toxic contacts, attracting values-aligned partners.', icon: 'users' },
      { id: 'ref_prog_successful', text: 'Becoming successful', desc: 'Scaling productivity to multiply professional/financial metrics.', icon: 'trending-up' },
      { id: 'ref_prog_in_control', text: 'Finally feeling in control of my life', desc: 'Sovereignty. You command your schedule, focus, and future.', icon: 'lock' }
    ],
    save: (val) => { state.sessionData.general_responses.reflection_progress = val; }
  },
  reflection_pride: {
    type: 'single',
    title: 'When was the last time you truly felt proud of yourself?',
    subtitle: 'A critical mirror. Realize where you stand.',
    options: [
      { id: 'ref_pride_today', text: 'Today', desc: 'Consistent wins, maintaining steady personal momentum.', icon: 'check-circle' },
      { id: 'ref_pride_last_few', text: 'Within the last few days', desc: 'Brief bursts, but looking for unshakeable permanence.', icon: 'rotate-cw' },
      { id: 'ref_pride_weeks', text: 'A few weeks ago', desc: 'Fading spark, need a major structural calibration.', icon: 'compass' },
      { id: 'ref_pride_months', text: 'A few months ago', desc: 'Struggling in a deep plateau, ready to break the lock.', icon: 'alert-triangle' },
      { id: 'ref_pride_year', text: 'Over a year ago', desc: 'A long stagnation loop. The transition begins today.', icon: 'shield-alert' },
      { id: 'ref_pride_remember', text: 'I honestly can’t remember', desc: 'We will rebuild your self-trust brick by brick. Stand up.', icon: 'help-circle' }
    ],
    save: (val) => { state.sessionData.general_responses.reflection_pride = val; }
  },
  
  // 13. IDENTITY PAGE (Universal)
  identity: {
    type: 'single',
    title: 'Which statement sounds most like you?',
    subtitle: 'This defines your deep mental archetype.',
    options: [
      { id: 'id_rebuild_life', text: 'I’m trying to rebuild my life slowly', desc: 'Healing systems, establishing gentle baseline routines.', icon: 'activity' },
      { id: 'id_disciplined', text: 'I want to become disciplined and consistent', desc: 'Systemizing habits, killing doomscrolling and distractions.', icon: 'lock' },
      { id: 'id_full_potential', text: 'I want to unlock my full potential', desc: 'High-end optimization across physical, focus, and lifestyle.', icon: 'zap' },
      { id: 'id_peace_balance', text: 'I want peace and balance', desc: 'Stoic resilience, mental calm, deep circadian rest.', icon: 'wind' },
      { id: 'id_transform', text: 'I want to transform myself completely', desc: 'Reinventing character, body, mind, and professional drive.', icon: 'sparkles' },
      { id: 'id_high_perf', text: 'I want a high-performance lifestyle', desc: 'Maximum leverage outputs, biological metrics, and grit.', icon: 'award' }
    ],
    save: (val) => { state.sessionData.general_responses.identity = val; }
  },
  
  // NEW PAGE — VALUES & PRIORITIES
  values_priorities: {
    type: 'multiple',
    title: 'What matters most to you right now?',
    subtitle: 'Select everything that resonates. This aligns your core drivers.',
    options: [
      { id: 'val_phys_health', text: 'Physical Health & Energy', desc: 'Optimizing body vitality, sleep cycles, and daily strength.', icon: 'activity' },
      { id: 'val_inner_peace', text: 'Inner Peace & Mental Calm', desc: 'Mindfulness practice, anxiety reduction, and mental silence.', icon: 'heart' },
      { id: 'val_success', text: 'Success & Achievement', desc: 'Reaching career goals, professional heights, and milestones.', icon: 'award' },
      { id: 'val_finance', text: 'Financial Freedom', desc: 'Sovereignty over money, investing, and asset building.', icon: 'dollar-sign' },
      { id: 'val_purpose', text: 'Purpose & Direction', desc: 'Finding your calling and living in complete alignment.', icon: 'compass' },
      { id: 'val_discipline', text: 'Discipline & Self-Control', desc: 'Building habits, killing procrastination, and consistency.', icon: 'lock' },
      { id: 'val_relationships', text: 'Deep Relationships', desc: 'Attracting noble peers, restoring family bonds, or dating.', icon: 'users' },
      { id: 'val_confidence', text: 'Confidence & Self-Respect', desc: 'Standing tall, conquering imposter loops, and speaking up.', icon: 'smile' },
      { id: 'val_happiness', text: 'Happiness & Enjoyment', desc: 'Prioritizing daily joy, laughter, and appreciation.', icon: 'sun' },
      { id: 'val_growth', text: 'Personal Growth', desc: 'Constant learning, book routines, and skill acquisition.', icon: 'trending-up' },
      { id: 'val_spiritual', text: 'Spiritual Balance', desc: 'Quiet reflection, inner connection, and meditation.', icon: 'wind' },
      { id: 'val_freedom', text: 'Freedom & Independence', desc: 'Designing your schedule and deciding your direction.', icon: 'shield' },
      { id: 'val_best_version', text: 'Becoming the Best Version of Myself', desc: 'The absolute commitment to self-actualization and victory.', icon: 'sparkles' }
    ],
    save: (vals) => { state.sessionData.general_responses.values_priorities = vals; }
  },

  // NEW PAGE — DAILY ENVIRONMENT
  daily_environment: {
    type: 'multiple',
    title: 'Where do you spend most of your time?',
    subtitle: 'Select all that apply. Your surroundings shape your habits.',
    options: [
      { id: 'env_home', text: 'At home with family', desc: 'Cozy spaces, domestic dynamics, and shared routines.', icon: 'home' },
      { id: 'env_alone', text: 'Mostly alone', desc: 'Solitary focus, quiet contemplation, or lonely plateaus.', icon: 'user' },
      { id: 'env_school', text: 'At school or college', desc: 'Study halls, lecture blocks, exams, and campus life.', icon: 'book-open' },
      { id: 'env_work', text: 'At work', desc: 'Office desks, virtual meetings, or manual work sites.', icon: 'briefcase' },
      { id: 'env_gym', text: 'In the gym', desc: 'Iron grinds, athletic circles, and physical tracking.', icon: 'dumbbell' },
      { id: 'env_online', text: 'Online or on social media', desc: 'Feeds, digital spaces, virtual communities.', icon: 'smartphone' },
      { id: 'env_friends', text: 'With friends', desc: 'Socializing, group hangouts, active shared time.', icon: 'users' },
      { id: 'env_outside', text: 'Outside/traveling', desc: 'Under the sky, exploring trails, or commuting often.', icon: 'map' },
      { id: 'env_gaming', text: 'Gaming or entertainment spaces', desc: 'Chasing digital goals, streaming, and relaxing.', icon: 'gamepad-2' },
      { id: 'env_public', text: 'Busy public environments', desc: 'Coffee shops, public transit, packed cities.', icon: 'map-pin' },
      { id: 'env_quiet', text: 'Quiet personal spaces', desc: 'My room, personal sanctuary, distraction-free zones.', icon: 'coffee' }
    ],
    save: (vals) => { state.sessionData.general_responses.daily_environment = vals; }
  },

  // NEW PAGE — ROUTINE CONFIDENCE SCALE
  routine_confidence: {
    type: 'custom',
    render: renderRoutineConfidence
  },

  // NEW PAGE — ADDICTIONS & DISTRACTIONS
  addictions_distractions: {
    type: 'multiple',
    title: 'Are there any habits or addictions currently holding you back?',
    subtitle: 'Select all that apply. Admitting is the first step to liberation.',
    options: [
      { id: 'add_social', text: 'Social media addiction', desc: 'Doomscrolling feeds and checking notification loops.', icon: 'smartphone' },
      { id: 'add_gaming', text: 'Gaming addiction', desc: 'Chasing virtual points instead of real-world accomplishments.', icon: 'gamepad-2' },
      { id: 'add_smoking', text: 'Smoking', desc: 'Nicotine reliance, smoke breaks, or vape use.', icon: 'wind' },
      { id: 'add_alcohol', text: 'Alcohol', desc: 'Frequent drinking, social reliance, or evening resets.', icon: 'wine' },
      { id: 'add_overeating', text: 'Overeating', desc: 'Sugar cravings, late-night junk, or stress-eating loops.', icon: 'activity' },
      { id: 'add_porn', text: 'Adult content/pornography', desc: 'Short-term dopamine hits depleting baseline drive.', icon: 'eye-off' },
      { id: 'add_procrastination', text: 'Constant procrastination', desc: 'Putting off hard things, resulting in panic cycles.', icon: 'clock' },
      { id: 'add_phone', text: 'Phone addiction', desc: 'Checking notifications every 5 minutes automatically.', icon: 'smartphone' },
      { id: 'add_scrolling', text: 'Late-night scrolling', desc: 'Doomscrolling in bed, destroying next-day energy.', icon: 'moon' },
      { id: 'add_overthinking', text: 'Overthinking', desc: 'Endless scenarios, analysis paralysis, and mind static.', icon: 'brain' },
      { id: 'add_negative_talk', text: 'Negative self-talk', desc: 'Imposter syndrome, low self-belief, and internal criticism.', icon: 'frown' },
      { id: 'add_none', text: 'None of these', desc: 'I am completely free of destructive habit loops right now.', icon: 'check-circle' }
    ],
    save: (vals) => { state.sessionData.general_responses.addictions_distractions = vals; }
  },

  // NEW PAGE — CHALLENGE INTENSITY
  challenge_intensity: {
    type: 'single',
    title: 'How would you like this journey to challenge you?',
    subtitle: 'Calibrate the friction. High friction builds hard steel.',
    options: [
      { id: 'int_gentle', text: 'Gentle & Supportive', desc: '“I want slow, sustainable progress without pressure.”', icon: 'heart' },
      { id: 'int_balanced', text: 'Balanced Growth', desc: '“Push me enough to grow while keeping things manageable.”', icon: 'trending-up' },
      { id: 'int_serious', text: 'Serious Transformation', desc: '“I want strong accountability and real discipline.”', icon: 'shield' },
      { id: 'int_elite', text: 'Elite Challenge Mode', desc: '“Push me hard. I want maximum growth and intensity.”', icon: 'zap' }
    ],
    save: (val) => { state.sessionData.general_responses.challenge_intensity = val; }
  },

  // NEW PAGE — PERSONALITY & ENERGY STYLE
  personality_energy: {
    type: 'single',
    title: 'Which description feels closest to your current energy?',
    subtitle: 'This defines your active state of action.',
    options: [
      { id: 'eng_calm', text: 'Calm but unmotivated', desc: 'Stable resting state, but lacking the fire of motivation.', icon: 'coffee' },
      { id: 'eng_ambitious', text: 'Ambitious but inconsistent', desc: 'High aspirations, but struggle with daily execution.', icon: 'trending-up' },
      { id: 'eng_exhausted', text: 'Mentally exhausted', desc: 'Feeling drained, burnt out, and needing steady recovery.', icon: 'battery-low' },
      { id: 'eng_lost', text: 'Lost and directionless', desc: 'Ready to work, but searching for a clear, meaningful path.', icon: 'compass' },
      { id: 'eng_quiet', text: 'Quietly determined', desc: 'Steady focus, working in silence towards specific benchmarks.', icon: 'shield' },
      { id: 'eng_driven', text: 'Highly driven but overwhelmed', desc: 'Fast execution, but dealing with high cognitive load.', icon: 'zap' },
      { id: 'eng_focused', text: 'Disciplined and focused', desc: 'Strong habits, seeking peak optimization and mastery.', icon: 'lock' },
      { id: 'eng_rebuilding', text: 'Rebuilding myself slowly', desc: 'Healing systems, taking step-by-step progress metrics.', icon: 'rotate-cw' },
      { id: 'eng_transform', text: 'Ready for a complete transformation', desc: 'The ultimate pivot point. Fully locked in for reinvention.', icon: 'sparkles' }
    ],
    save: (val) => { state.sessionData.general_responses.personality_energy = val; }
  },

  // NEW PAGE — FUTURE SELF VISION
  future_self_vision: {
    type: 'multiple',
    title: 'If everything improved in the next year, what would change the most?',
    subtitle: 'Select everything that applies. Vision anchors consistency.',
    options: [
      { id: 'vis_body', text: 'My body and health', desc: 'Gaining athletic shape, clean power, and longevity.', icon: 'activity' },
      { id: 'vis_confidence', text: 'My confidence', desc: 'Standing tall, speaking with voice, killing self-doubt.', icon: 'smile' },
      { id: 'vis_discipline', text: 'My discipline', desc: 'Owning my habits, showing up daily without resistance.', icon: 'lock' },
      { id: 'vis_relationships', text: 'My relationships', desc: 'Surrounding myself with values-aligned peers and partners.', icon: 'users' },
      { id: 'vis_happiness', text: 'My happiness', desc: 'Enjoying daily moments, feeling full appreciation.', icon: 'sun' },
      { id: 'vis_finances', text: 'My finances/career', desc: 'Multiplying professional metrics and capital scaling.', icon: 'dollar-sign' },
      { id: 'vis_mindset', text: 'My mindset', desc: 'Mastering attention, Stoicism, and emotional sovereignty.', icon: 'brain' },
      { id: 'vis_productivity', text: 'My productivity', desc: 'Maximizing high-impact outputs and flow states.', icon: 'zap' },
      { id: 'vis_peace', text: 'My peace of mind', desc: 'Silencing overthinking and daily anxiety vectors.', icon: 'wind' },
      { id: 'vis_purpose', text: 'My purpose in life', desc: 'Connecting daily effort to a clear, ultimate calling.', icon: 'target' }
    ],
    save: (vals) => { state.sessionData.general_responses.future_self_vision = vals; }
  },

  // NEW PAGE — FINAL MINDSET CHECK
  final_mindset: {
    type: 'single',
    title: 'What kind of life are you trying to build?',
    subtitle: 'This defines your ultimate blueprint target.',
    options: [
      { id: 'mnd_peace', text: 'A peaceful and balanced life', desc: 'Prioritizing rest, mindfulness, clean routines, and calm.', icon: 'wind' },
      { id: 'mnd_success', text: 'A disciplined and successful life', desc: 'Reaching professional peaks, building financial security.', icon: 'shield' },
      { id: 'mnd_confident', text: 'A confident and respected life', desc: 'Standing tall in the community, building strong boundaries.', icon: 'users' },
      { id: 'mnd_healthy', text: 'A healthy and energetic life', desc: 'Fueling my biology, waking up with power and athletic vigor.', icon: 'activity' },
      { id: 'mnd_meaning', text: 'A meaningful and purposeful life', desc: 'Connecting my career, relationships, and actions to a calling.', icon: 'target' },
      { id: 'mnd_transform', text: 'A complete personal transformation', desc: 'Rebuilding body, mind, habits, and career from the ground up.', icon: 'sparkles' }
    ],
    save: (val) => { state.sessionData.general_responses.final_mindset = val; }
  },

  // NEW PAGE — AI ANALYSIS LOADING
  ai_analysis_loading: {
    type: 'custom',
    render: renderAiAnalysisLoading
  },
  
  // NEW PAGE — HOW WE SEE YOU
  how_we_see_you: {
    type: 'custom',
    render: renderHowWeSeeYou
  },
  
  // NEW PAGE — WHAT'S HOLDING YOU BACK
  whats_holding_you_back: {
    type: 'custom',
    render: renderWhatsHoldingYouBack
  },
  
  // NEW PAGE — WHAT MOST PEOPLE NEVER REALIZE
  what_most_never_realize: {
    type: 'custom',
    render: renderWhatMostNeverRealize
  },
  
  // NEW PAGE — TRANSFORMATION PREVIEW
  transformation_preview: {
    type: 'custom',
    render: renderTransformationPreview
  },
  
  // 14. FINAL ROADMAP ONBOARDING COMPLETE (Universal)
  final_roadmap: {
    type: 'custom',
    render: renderRoadmapScreen
  }
};

// --- Ambient Background Rendering Engine (Trigonometry-based Canvas) ---
function initAmbientCanvas() {
  const canvas = document.getElementById('ambient-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);
  
  window.addEventListener('resize', () => {
    width = (canvas.width = window.innerWidth);
    height = (canvas.height = window.innerHeight);
  });
  
  // Define 3 dynamic fluid blobs
  const blobs = [
    {
      x: width * 0.3,
      y: height * 0.3,
      radius: Math.min(width, height) * 0.35,
      color: 'rgba(99, 102, 241, 0.16)', // Translucent Indigo
      vx: 0.5,
      vy: 0.6,
      angle: 0
    },
    {
      x: width * 0.7,
      y: height * 0.6,
      radius: Math.min(width, height) * 0.4,
      color: 'rgba(139, 92, 246, 0.14)', // Translucent Purple
      vx: -0.4,
      vy: -0.5,
      angle: Math.PI / 3
    },
    {
      x: width * 0.5,
      y: height * 0.8,
      radius: Math.min(width, height) * 0.3,
      color: 'rgba(6, 182, 212, 0.12)', // Translucent Cyan
      vx: 0.3,
      vy: -0.4,
      angle: Math.PI * 2 / 3
    }
  ];
  
  // Define 45 stardust particles
  const particles = [];
  const particleCount = 45;
  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 1.5 + 0.5,
      speedY: -Math.random() * 0.4 - 0.1,
      speedX: (Math.random() - 0.5) * 0.15,
      alpha: Math.random() * 0.5 + 0.1
    });
  }
  
  let lastTime = 0;
  function animate(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, width, height);
    
    // Render organic, breathing fluid blobs
    blobs.forEach((blob, idx) => {
      blob.angle += 0.2 * dt;
      // Trigonometric swaying
      const breatheOffset = Math.sin(blob.angle) * 35;
      const currentRadius = blob.radius + breatheOffset;
      
      const swayX = Math.sin(blob.angle * 0.5) * 60;
      const swayY = Math.cos(blob.angle * 0.5) * 60;
      
      const grad = ctx.createRadialGradient(
        blob.x + swayX, blob.y + swayY, 0,
        blob.x + swayX, blob.y + swayY, currentRadius
      );
      grad.addColorStop(0, blob.color);
      grad.addColorStop(1, 'rgba(5, 7, 12, 0)');
      
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(blob.x + swayX, blob.y + swayY, currentRadius, 0, Math.PI * 2);
      ctx.fill();
      
      // Boundaries bounce
      blob.x += blob.vx * 15 * dt;
      blob.y += blob.vy * 15 * dt;
      
      if (blob.x - blob.radius < 0 || blob.x + blob.radius > width) blob.vx *= -1;
      if (blob.y - blob.radius < 0 || blob.y + blob.radius > height) blob.vy *= -1;
    });
    
    // Draw stardust drifting gently upward
    ctx.fillStyle = 'rgba(243, 244, 246, 0.4)';
    particles.forEach(p => {
      p.y += p.speedY;
      p.x += p.speedX;
      
      // Reset if drifts off-screen
      if (p.y < -10) {
        p.y = height + 10;
        p.x = Math.random() * width;
      }
      if (p.x < -10 || p.x > width + 10) {
        p.x = Math.random() * width;
      }
      
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
      ctx.fill();
    });
    
    requestAnimationFrame(animate);
  }
  
  requestAnimationFrame(animate);
}

// --- Dynamic Flow Queue Manager ---
function initializeState() {
  state.currentStepIndex = 0;
  state.sessionData.id = 'session_' + Date.now();
  state.sessionData.timestamp = new Date().toISOString();
  
  // Base initial queue
  state.activeQueue = ['welcome', 'basic_info', 'life_state', 'focus_areas'];
  
  // Sync the navigation header state (hidden initially)
  const header = document.getElementById('app-header');
  if (header) header.classList.remove('visible');
  
  updateDBInspectorBadge();
}

function buildDynamicQueue() {
  const chosen = state.sessionData.focus_areas;
  
  // Build dynamic nodes array based on focus selections
  const dynamicNodes = [];
  
  // 1. Physical Health & Fitness Flow
  if (chosen.includes('Physical Health & Fitness')) {
    dynamicNodes.push('fitness_lifestyle', 'fitness_goal', 'fitness_obstacle');
  }
  
  // 2. Relationships & Social Life Flow
  if (chosen.includes('Relationships & Social Life') || chosen.includes('Confidence & Self-Esteem')) {
    dynamicNodes.push('relationships_target', 'relationships_challenge');
  }
  
  // 3. Focus & Productivity Flow
  if (chosen.includes('Focus & Productivity') || chosen.includes('Education & Learning')) {
    dynamicNodes.push('education_state', 'education_distraction');
  }
  
  // 4. Discipline & Consistency Flow
  if (chosen.includes('Discipline & Consistency') || chosen.includes('Motivation & Purpose')) {
    dynamicNodes.push('discipline_state', 'discipline_motivation');
  }
  
  // 5. Sleep & Energy Flow
  if (chosen.includes('Sleep & Energy')) {
    dynamicNodes.push('sleep_state');
  }
  
  // 6. Eating Habits Flow (Only triggers if Physical Health is chosen)
  if (chosen.includes('Physical Health & Fitness')) {
    dynamicNodes.push('eating_state', 'eating_support');
  }
  
  // Core universal pages to chain at the end
  const universalEndNodes = [
    'routine',
    'reflection_progress',
    'reflection_pride',
    'identity',
    'values_priorities',
    'daily_environment',
    'routine_confidence',
    'addictions_distractions',
    'challenge_intensity',
    'personality_energy',
    'future_self_vision',
    'final_mindset',
    'ai_analysis_loading',
    'how_we_see_you',
    'whats_holding_you_back',
    'what_most_never_realize',
    'transformation_preview',
    'final_roadmap'
  ];
  
  // Re-build active queue: Base initial queue + dynamic selections + ending pages
  state.activeQueue = [
    'welcome',
    'basic_info',
    'life_state',
    'focus_areas',
    ...dynamicNodes,
    ...universalEndNodes
  ];
}

// Injects Sleep support follow-up dynamically after the sleep_state page
function injectSleepSupportNode() {
  const currentIndex = state.activeQueue.indexOf('sleep_state');
  if (currentIndex !== -1 && !state.activeQueue.includes('sleep_support')) {
    state.activeQueue.splice(currentIndex + 1, 0, 'sleep_support');
  }
}

// --- Active Node Page Router & Render Engine ---
let _isTransitioning = false; // Lock flag — prevents concurrent double-renders

function renderActiveStep() {
  // Guard: if a transition is already in flight, ignore duplicate calls
  if (_isTransitioning) return;
  _isTransitioning = true;

  const container = document.getElementById('app-container');
  const nodeKey = state.activeQueue[state.currentStepIndex];
  state.activeNode = ALL_FLOW_NODES[nodeKey];

  // 1. Manage Navigation Header Visibility
  const header = document.getElementById('app-header');
  if (header) {
    if (nodeKey === 'welcome' || nodeKey === 'final_roadmap') {
      header.classList.remove('visible');
    } else {
      header.classList.add('visible');
      updateProgressBar();
    }
  }

  // 2. Build the incoming page element (but don't attach yet)
  const viewWrap = document.createElement('div');
  viewWrap.className = 'page-view';

  if (state.activeNode.type === 'custom') {
    state.activeNode.render(viewWrap);
  } else {
    renderStandardOptionCard(viewWrap);
  }

  // 3. Collect ALL existing page-view nodes (handles edge cases where
  //    multiple nodes accumulated during fast navigation)
  const oldCards = Array.from(container.querySelectorAll('.page-view'));

  if (oldCards.length > 0) {
    // Mark every stale card as exiting simultaneously
    oldCards.forEach(c => c.classList.add('exit'));

    setTimeout(() => {
      // Hard-remove every stale card — this is the critical purge step
      oldCards.forEach(c => c.remove());

      // Attach and activate the fresh card
      container.appendChild(viewWrap);
      // Reset scroll so every new question starts at the very top
      container.scrollTop = 0;

      requestAnimationFrame(() => {
        viewWrap.classList.add('active');
        lucide.createIcons();
        bindCardGlowListeners();
        _isTransitioning = false; // Release lock
      });
    }, 380); // Slightly under the CSS transition (0.4s) so removal feels instant
  } else {
    // First render — no old card to clear
    container.appendChild(viewWrap);
    container.scrollTop = 0;

    requestAnimationFrame(() => {
      viewWrap.classList.add('active');
      lucide.createIcons();
      bindCardGlowListeners();
      _isTransitioning = false; // Release lock
    });
  }
}

// Updates top horizontal progress percentage
function updateProgressBar() {
  const fill = document.getElementById('progress-bar-fill');
  const text = document.getElementById('progress-text');
  
  // We exclude Page 1 (welcome) and the Roadmap page (final_roadmap) from calculations
  const totalQuestions = state.activeQueue.filter(key => key !== 'welcome' && key !== 'final_roadmap').length;
  const currentQuestionIdx = state.activeQueue.indexOf(state.activeQueue[state.currentStepIndex]) - 0; // index offset
  
  const percent = Math.min(100, Math.max(0, (currentQuestionIdx / totalQuestions) * 100));
  
  if (fill) fill.style.width = `${percent}%`;
  if (text) text.innerText = `Step ${currentQuestionIdx} of ${totalQuestions}`;
}

// Binds cursor-following radial hover variables
function bindCardGlowListeners() {
  const cards = document.querySelectorAll('.glow-card, .selector-option, .btn-premium');
  cards.forEach(card => {
    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });
  });
}

// --- Card Renderers & Custom Screen Layouts ---

// Standard option renderer (supporting Single and Multiple selection cards)
function renderStandardOptionCard(viewWrap) {
  const isMultiple = state.activeNode.type === 'multiple';
  
  // Retrieve previously selected value if navigating backward
  const nodeKey = state.activeQueue[state.currentStepIndex];
  let selectedVal = null;
  if (isMultiple) {
    // Check flow_responses first, then top-level sessionData (covers life_state & focus_areas),
    // then focus_areas array, then default to empty array.
    const topLevel = state.sessionData[nodeKey];
    selectedVal = state.sessionData.flow_responses[nodeKey]
               || state.sessionData.general_responses[nodeKey]
               || (Array.isArray(topLevel) ? topLevel : null)
               || [];
  } else {
    selectedVal = state.sessionData.flow_responses[nodeKey] ||
                  state.sessionData.general_responses[nodeKey] || '';
  }
  
  viewWrap.innerHTML = `
    <div class="question-header">
      <span class="question-pre">Kairos Analysis</span>
      <h2 class="question-title">${state.activeNode.title}</h2>
      <p class="question-desc">${state.activeNode.subtitle}</p>
    </div>
    
    <div class="${isMultiple ? 'cards-grid' : 'cards-layout'}">
      ${state.activeNode.options.map(opt => {
        const isSel = isMultiple ? selectedVal.includes(opt.text) : selectedVal === opt.text;
        
        // Custom dynamic classing based on Challenge Intensity selections
        let intensityGlow = '';
        if (nodeKey === 'challenge_intensity') {
          if (opt.text.includes('Gentle')) intensityGlow = 'intensity-gentle';
          else if (opt.text.includes('Balanced')) intensityGlow = 'intensity-balanced';
          else if (opt.text.includes('Serious')) intensityGlow = 'intensity-serious';
          else if (opt.text.includes('Elite')) intensityGlow = 'intensity-elite';
        }
        
        return `
          <div class="glow-card ${isSel ? 'selected' : ''} ${intensityGlow}" data-value="${opt.text}">
            <div class="card-icon-box">
              <i data-lucide="${opt.icon}"></i>
            </div>
            <div class="card-content">
              <span class="card-title">${opt.text}</span>
              <p class="card-desc">${opt.desc}</p>
            </div>
            <div class="card-indicator">
              <i data-lucide="check"></i>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    
    ${isMultiple ? `
      <div class="action-bar">
        <button id="btn-submit-multiple" class="btn-premium primary" disabled>
          <span>Continue</span>
          <i data-lucide="arrow-right"></i>
        </button>
      </div>
    ` : ''}
  `;
  
  // Attach Choice Handlers
  const cards = viewWrap.querySelectorAll('.glow-card');
  
  if (isMultiple) {
    const continueBtn = viewWrap.querySelector('#btn-submit-multiple');
    let chosenArray = [...selectedVal];
    
    // Enable button initially if items are already pre-selected (back navigation)
    if (chosenArray.length > 0) continueBtn.removeAttribute('disabled');
    
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const val = card.getAttribute('data-value');
        
        if (val === 'None of these') {
          // If none of these is clicked, clear all other selections and select only none
          chosenArray = ['None of these'];
          cards.forEach(c => {
            if (c.getAttribute('data-value') !== 'None of these') {
              c.classList.remove('selected');
            }
          });
          card.classList.add('selected');
        } else {
          // If a standard item is clicked, deselect 'None of these' if it was selected
          chosenArray = chosenArray.filter(v => v !== 'None of these');
          const noneCard = Array.from(cards).find(c => c.getAttribute('data-value') === 'None of these');
          if (noneCard) noneCard.classList.remove('selected');
          
          if (chosenArray.includes(val)) {
            chosenArray = chosenArray.filter(v => v !== val);
            card.classList.remove('selected');
          } else {
            chosenArray.push(val);
            card.classList.add('selected');
          }
        }
        
        if (chosenArray.length > 0) {
          continueBtn.removeAttribute('disabled');
        } else {
          continueBtn.setAttribute('disabled', 'true');
        }
      });
    });
    
    continueBtn.addEventListener('click', () => {
      // Save and advance
      state.activeNode.save(chosenArray);
      advanceStep();
    });
    
  } else {
    // Single Selection Flow: Snappy card select
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        
        const val = card.getAttribute('data-value');
        state.activeNode.save(val);
        
        // Brief organic delay before automatic step advancement
        setTimeout(() => {
          advanceStep();
        }, 400);
      });
    });
  }
}

// SCREEN 1: Cinematic Welcome / Sign-In Page
const MOTIVATIONAL_QUOTES = [
  "“The best time to plant a tree was 20 years ago. The second best time is now.”",
  "“You do not rise to the level of your goals. You fall to the level of your systems.”",
  "“He who has a why to live for can bear almost any how.”",
  "“Discipline is choosing between what you want now and what you want most.”",
  "“It is not because things are difficult that we do not dare; it is because we do not dare that they are difficult.”"
];

function renderWelcomeScreen(viewWrap) {
  viewWrap.className = 'page-view welcome-screen';
  viewWrap.innerHTML = `
    <div class="welcome-logo-area">
      <div class="logo-icon-glow">
        <i data-lucide="compass"></i>
      </div>
      <h1 class="welcome-title">Kairos</h1>
      <p class="welcome-subtitle">Build the life you know you’re capable of.</p>
    </div>
    
    <!-- Rotating Quotes Carousel -->
    <div class="quote-carousel" id="quote-carousel">
      ${MOTIVATIONAL_QUOTES.map((q, idx) => `
        <span class="quote-item ${idx === 0 ? 'active' : ''}">${q}</span>
      `).join('')}
    </div>
    
    <div class="welcome-buttons-container">
      <button class="btn-premium primary" id="btn-start-google">
        <i data-lucide="chrome"></i>
        <span>Continue with Google</span>
      </button>
      <button class="btn-premium" id="btn-start-email">
        <i data-lucide="mail"></i>
        <span>Continue with Email</span>
      </button>
      <button class="btn-premium" id="btn-start-generic" style="font-size: 13px; color: var(--text-secondary); border-color: transparent; background: transparent;">
        <span>Or create account manually</span>
      </button>
    </div>
  `;
  
  // Set Quote Cycle Loop
  let activeQuoteIdx = 0;
  const quoteInterval = setInterval(() => {
    const items = viewWrap.querySelectorAll('.quote-item');
    if (items.length === 0) {
      clearInterval(quoteInterval);
      return;
    }
    
    items[activeQuoteIdx].classList.remove('active');
    activeQuoteIdx = (activeQuoteIdx + 1) % items.length;
    items[activeQuoteIdx].classList.add('active');
  }, 4500);
  
  // Sign In triggers onboarding entry transition
  const enterOnboarding = () => {
    clearInterval(quoteInterval);
    advanceStep();
  };
  
  viewWrap.querySelector('#btn-start-google').addEventListener('click', enterOnboarding);
  viewWrap.querySelector('#btn-start-email').addEventListener('click', enterOnboarding);
  viewWrap.querySelector('#btn-start-generic').addEventListener('click', enterOnboarding);
}

// SCREEN 2: Basic Info Form Fields
const COUNTRIES_LIST = ["United States", "United Kingdom", "Canada", "Germany", "India", "Australia", "Singapore", "France", "Japan", "Brazil", "Other"];

function renderBasicInfoForm(viewWrap) {
  const info = state.sessionData.basic_info;
  
  viewWrap.innerHTML = `
    <div class="question-header">
      <span class="question-pre">Profile Initialization</span>
      <h2 class="question-title">Tell us a little about yourself.</h2>
      <p class="question-desc">We tailor habits and scheduling to your baseline details.</p>
    </div>
    
    <form class="form-grid" id="basic-info-form" onsubmit="return false;">
      <!-- First Name -->
      <div class="form-group">
        <label class="form-label" for="inp-first-name">First Name</label>
        <input type="text" id="inp-first-name" class="input-premium" placeholder="e.g. Alexander" value="${info.first_name}" required autocomplete="off">
      </div>
      
      <!-- Age -->
      <div class="form-group">
        <label class="form-label" for="inp-age">Age</label>
        <input type="number" id="inp-age" class="input-premium" min="12" max="100" placeholder="25" value="${info.age || ''}" required>
      </div>
      
      <!-- Gender Cards -->
      <div class="form-group full-width">
        <label class="form-label">Gender Identity</label>
        <div class="select-grid" id="grid-gender">
          <div class="selector-option ${info.gender === 'Male' ? 'selected' : ''}" data-val="Male">Male</div>
          <div class="selector-option ${info.gender === 'Female' ? 'selected' : ''}" data-val="Female">Female</div>
          <div class="selector-option ${info.gender === 'Non-binary' ? 'selected' : ''}" data-val="Non-binary">Non-binary</div>
          <div class="selector-option ${info.gender === 'Prefer not to say' ? 'selected' : ''}" data-val="Prefer not to say">Skip</div>
        </div>
      </div>
      
      <!-- Country Dropdown -->
      <div class="form-group">
        <label class="form-label" for="sel-country">Country</label>
        <select id="sel-country" class="input-premium" style="background-color: #0b0f19;">
          <option value="" disabled ${!info.country ? 'selected' : ''}>Select Country</option>
          ${COUNTRIES_LIST.map(c => `
            <option value="${c}" ${info.country === c ? 'selected' : ''}>${c}</option>
          `).join('')}
        </select>
      </div>
      
      <!-- Occupation -->
      <div class="form-group">
        <label class="form-label" for="sel-occupation">Occupation Status</label>
        <select id="sel-occupation" class="input-premium" style="background-color: #0b0f19;">
          <option value="" disabled ${!info.occupation ? 'selected' : ''}>Select Occupation</option>
          <option value="Student" ${info.occupation === 'Student' ? 'selected' : ''}>Student</option>
          <option value="Working Professional" ${info.occupation === 'Working Professional' ? 'selected' : ''}>Working</option>
          <option value="Self-employed" ${info.occupation === 'Self-employed' ? 'selected' : ''}>Self-employed</option>
          <option value="Other" ${info.occupation === 'Other' ? 'selected' : ''}>Other / Transitional</option>
        </select>
      </div>

      <!-- Relationship Status -->
      <div class="form-group full-width">
        <label class="form-label">Relationship Focus</label>
        <div class="select-grid" id="grid-relationship">
          <div class="selector-option ${info.relationship_status === 'Single' ? 'selected' : ''}" data-val="Single">Single</div>
          <div class="selector-option ${info.relationship_status === 'In a relationship' ? 'selected' : ''}" data-val="In a relationship">Dating</div>
          <div class="selector-option ${info.relationship_status === 'Married' ? 'selected' : ''}" data-val="Married">Married</div>
          <div class="selector-option ${info.relationship_status === 'Focus on self' ? 'selected' : ''}" data-val="Focus on self">Focus on self</div>
        </div>
      </div>
      
      <!-- Fitness Activity -->
      <div class="form-group full-width">
        <label class="form-label" for="sel-activity">Current Fitness Activity Level</label>
        <select id="sel-activity" class="input-premium" style="background-color: #0b0f19;">
          <option value="" disabled ${!info.activity_level ? 'selected' : ''}>Select Activity Baseline</option>
          <option value="Sedentary" ${info.activity_level === 'Sedentary' ? 'selected' : ''}>Sedentary (Rare movement)</option>
          <option value="Lightly Active" ${info.activity_level === 'Lightly Active' ? 'selected' : ''}>Lightly Active (Occasional walks)</option>
          <option value="Moderately Active" ${info.activity_level === 'Moderately Active' ? 'selected' : ''}>Moderately Active (3x training/wk)</option>
          <option value="Very Active" ${info.activity_level === 'Very Active' ? 'selected' : ''}>Very Active (Daily rigorous athletics)</option>
        </select>
      </div>
    </form>
    
    <div class="action-bar" style="margin-top: 16px;">
      <button id="btn-submit-info" class="btn-premium primary">
        <span>Continue</span>
        <i data-lucide="arrow-right"></i>
      </button>
    </div>
  `;
  
  // Segmented selectors trigger listeners
  const setupSegmented = (containerId, stateKey) => {
    const options = viewWrap.querySelectorAll(`#${containerId} .selector-option`);
    options.forEach(opt => {
      opt.addEventListener('click', () => {
        options.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        info[stateKey] = opt.getAttribute('data-val');
      });
    });
  };
  
  setupSegmented('grid-gender', 'gender');
  setupSegmented('grid-relationship', 'relationship_status');
  
  // Form submission validations
  viewWrap.querySelector('#btn-submit-info').addEventListener('click', () => {
    const nameInp = viewWrap.querySelector('#inp-first-name');
    const ageInp = viewWrap.querySelector('#inp-age');
    const countrySel = viewWrap.querySelector('#sel-country');
    const occupSel = viewWrap.querySelector('#sel-occupation');
    const activeSel = viewWrap.querySelector('#sel-activity');
    
    // Quick interactive validation triggers
    if (!nameInp.value.trim()) {
      highlightError(nameInp);
      return;
    }
    if (!ageInp.value || ageInp.value < 12 || ageInp.value > 100) {
      highlightError(ageInp);
      return;
    }
    if (!info.gender) {
      highlightError(viewWrap.querySelector('#grid-gender'));
      return;
    }
    if (!countrySel.value) {
      highlightError(countrySel);
      return;
    }
    if (!occupSel.value) {
      highlightError(occupSel);
      return;
    }
    if (!info.relationship_status) {
      highlightError(viewWrap.querySelector('#grid-relationship'));
      return;
    }
    if (!activeSel.value) {
      highlightError(activeSel);
      return;
    }
    
    // Compile and advance
    info.first_name = nameInp.value.trim();
    info.age = parseInt(ageInp.value);
    info.country = countrySel.value;
    info.occupation = occupSel.value;
    info.activity_level = activeSel.value;
    
    advanceStep();
  });
}

function highlightError(element) {
  element.style.borderColor = '#ef4444';
  element.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.2)';
  setTimeout(() => {
    element.style.borderColor = '';
    element.style.boxShadow = '';
  }, 1500);
}

function validateBasicInfoForm() {
  const info = state.sessionData.basic_info;
  return info.first_name && info.age && info.gender && info.country && info.occupation && info.relationship_status && info.activity_level;
}

// SCREEN: Interactive 1-10 Routine Confidence Slider Scale
function renderRoutineConfidence(viewWrap) {
  const prevVal = state.sessionData.general_responses.routine_confidence || 5;
  
  viewWrap.innerHTML = `
    <div class="question-header">
      <span class="question-pre">Self-Trust Metric</span>
      <h2 class="question-title">How confident are you that you can stick to a routine for 7 days?</h2>
      <p class="question-desc">Be completely honest with yourself. This calibrates habit volume.</p>
    </div>
    
    <div class="slider-container-box">
      <!-- Big Circle Value Indicator -->
      <div class="slider-glow-value" id="slider-glow-val">${prevVal}</div>
      
      <!-- Range Slider -->
      <div class="slider-input-wrapper">
        <input type="range" id="routine-slider" min="1" max="10" step="1" value="${prevVal}" class="premium-range-slider">
        <div class="slider-ticks">
          ${Array.from({length: 10}, (_, i) => `<span class="tick-label">${i+1}</span>`).join('')}
        </div>
      </div>
      
      <!-- Live Dynamic Feedback Box -->
      <div class="feedback-card glow-card" id="feedback-card-box">
        <div class="feedback-icon-box" id="feedback-icon">
          <i data-lucide="compass"></i>
        </div>
        <div class="feedback-content">
          <span class="feedback-tier" id="feedback-tier">Level 5 Confidence</span>
          <p class="feedback-text" id="feedback-txt">I can stay disciplined sometimes.</p>
        </div>
      </div>
    </div>
    
    <div class="action-bar">
      <button id="btn-submit-slider" class="btn-premium primary">
        <span>Continue</span>
        <i data-lucide="arrow-right"></i>
      </button>
    </div>
  `;
  
  const slider = viewWrap.querySelector('#routine-slider');
  const glowVal = viewWrap.querySelector('#slider-glow-val');
  const feedbackCard = viewWrap.querySelector('#feedback-card-box');
  const feedbackTier = viewWrap.querySelector('#feedback-tier');
  const feedbackTxt = viewWrap.querySelector('#feedback-txt');
  const feedbackIcon = viewWrap.querySelector('#feedback-icon');
  
  const getFeedbackData = (val) => {
    if (val <= 3) {
      return {
        tier: "Developing Consistency",
        text: "“I struggle with consistency right now.”",
        icon: "battery-low",
        color: "rgba(239, 68, 68, 0.12)", // red
        glow: "0 0 20px rgba(239, 68, 68, 0.25)"
      };
    } else if (val <= 6) {
      return {
        tier: "Moderate Consistency",
        text: "“I can stay disciplined sometimes.”",
        icon: "compass",
        color: "rgba(245, 158, 11, 0.12)", // orange/amber
        glow: "0 0 20px rgba(245, 158, 11, 0.25)"
      };
    } else if (val <= 8) {
      return {
        tier: "Strong Consistency",
        text: "“I usually stay committed once I start.”",
        icon: "trending-up",
        color: "rgba(6, 182, 212, 0.12)", // cyan
        glow: "0 0 20px rgba(6, 182, 212, 0.25)"
      };
    } else {
      return {
        tier: "Unshakable Consistency",
        text: "“I trust myself to stay consistent.”",
        icon: "shield",
        color: "rgba(139, 92, 246, 0.12)", // violet/purple
        glow: "0 0 20px rgba(139, 92, 246, 0.25)"
      };
    }
  };
  
  const updateFeedback = (val) => {
    const data = getFeedbackData(val);
    glowVal.innerText = val;
    feedbackTier.innerText = `${data.tier} (Level ${val}/10)`;
    feedbackTxt.innerText = data.text;
    feedbackIcon.innerHTML = `<i data-lucide="${data.icon}"></i>`;
    lucide.createIcons();
    
    // Smooth color shift
    feedbackCard.style.background = `linear-gradient(135deg, rgba(255, 255, 255, 0.05), ${data.color})`;
    feedbackCard.style.boxShadow = data.glow;
    feedbackCard.style.borderColor = data.color.replace('0.12', '0.4');
    
    // Add custom glow effect to the large numeric label
    glowVal.style.color = 'var(--text-white)';
    glowVal.style.textShadow = `0 0 20px ${data.color.replace('0.12', '0.6')}`;
  };
  
  // Initialize
  updateFeedback(parseInt(slider.value));
  
  slider.addEventListener('input', (e) => {
    updateFeedback(parseInt(e.target.value));
  });
  
  viewWrap.querySelector('#btn-submit-slider').addEventListener('click', () => {
    state.sessionData.general_responses.routine_confidence = parseInt(slider.value);
    advanceStep();
  });
}

// --- AI PERSONALITY ANALYSIS & COPY GENERATION ENGINE ---
function generateAIPersonalityAnalysis() {
  const info = state.sessionData.basic_info || { first_name: 'Alexander' };
  const energy = state.sessionData.general_responses.personality_energy || '';
  const stateVal = state.sessionData.life_state || [];
  const confidence = state.sessionData.general_responses.routine_confidence || 5;
  const addictions = state.sessionData.general_responses.addictions_distractions || [];
  const routine = state.sessionData.general_responses.routine || '';
  const challenge = state.sessionData.general_responses.challenge_intensity || 'Balanced Growth';
  const values = state.sessionData.general_responses.values_priorities || [];
  const vision = state.sessionData.general_responses.future_self_vision || [];
  const mindset = state.sessionData.general_responses.final_mindset || '';

  // 1. Core Mindset Card (Card 1)
  let mindsetTitle = 'The Silent Anchor';
  let mindsetText = `You carry a steady, quiet determination but feel trapped by a lack of absolute daily clarity. You have high self-awareness and want to apply yourself, but you are currently running in circles because your daily actions are not connected to a clear 'why'. We see a solid foundation ready to compound rapidly once we anchor your habits to a singular, ultimate calling.`;
  let mindsetTags = ['Quietly Determined', 'High Self-Awareness', 'Unlocking Clarity'];

  if (energy.includes('Mentally exhausted') || energy.includes('Rebuilding myself slowly')) {
    mindsetTitle = 'A Soul in Recovery';
    mindsetText = `You are navigating a phase of mental fatigue and cognitive overload. You possess a strong desire for personal growth, but your battery is depleted. Your primary task is not to enforce rigid, military discipline, but to focus on gentle circadian resets and baseline micro-routines to rebuild your self-trust before scaling challenge layers.`;
    mindsetTags = ['Mindful Recovery', 'Circadian Reset', 'Rebuilding Baseline'];
  } else if (energy.includes('Ambitious but inconsistent') || energy.includes('Ready for a complete transformation')) {
    mindsetTitle = 'The Aspiring Catalyst';
    mindsetText = `You carry a massive spark of ambition and a clear vision of your potential. However, you currently suffer from 'motivation dependency'—experiencing intense bursts of effort followed by rapid collapse cycles. Your path requires shifting from emotional inspiration to quiet, systemic habits that run automatically on dark days.`;
    mindsetTags = ['Ambitious Drive', 'Habit Autopilot', 'Slaying Inconsistency'];
  } else if (energy.includes('Highly driven but overwhelmed') || energy.includes('Disciplined and focused')) {
    mindsetTitle = 'The High-Performance Engine';
    mindsetText = `You possess high execution power and natural drive. You don't struggle to take action; instead, you struggle to manage your cognitive capacity, spreading yourself too thin across multiple vectors. You run at redline speed. Your growth lies in radical simplification, energetic boundaries, and Stoic self-stewardship.`;
    mindsetTags = ['High Execution', 'Simplifying Focus', 'Burnout Prevention'];
  }

  // 2. Current Patterns Card (Card 2)
  let patternsTitle = 'Energy & Focus Flow';
  let patternsText = `Your daily patterns show high intent but variable execution. Your routine stability is currently fragmented by situational changes, forcing you to constantly expend willpower to get started. By scheduling predictable anchors, we will turn discipline into a frictionless habit.`;
  let patternsTags = ['Variable Routines', 'Willpower Reserves', 'Predictable Anchors'];

  let sleepPattern = '';
  if (addictions.includes('Late-night scrolling') || state.sessionData.flow_responses.sleep_state?.includes('Poor')) {
    sleepPattern = 'Your sleep architecture is currently volatile due to bedtime stimulation or doomscrolling. Waking up exhausted creates a mid-day focus crash, forcing you to rely on stimulants or sheer willpower.';
  } else {
    sleepPattern = 'Your sleep cycle is reasonably stable, providing a solid chemical baseline for cognitive energy and mid-day stamina.';
  }

  let environmentPattern = '';
  if (addictions.includes('Phone addiction') || addictions.includes('Social media addiction')) {
    environmentPattern = 'Digital dopamine loops—constant notifications and phone checks—have micro-fragmented your attention span. This makes deep work feel painful, causing a drift to instant escapes.';
  } else if (addictions.includes('Overthinking') || addictions.includes('Negative self-talk')) {
    environmentPattern = 'Your primary focus leak is internal. Overthinking, perfectionism, and self-doubt paralyze your activation gates, draining your willpower before you even begin a task.';
  } else {
    environmentPattern = 'Your distraction hygiene is excellent, letting us bypass basic adjustments and go straight into refining peak focus states.';
  }

  patternsText = `${sleepPattern} ${environmentPattern}`;
  
  if (addictions.includes('Phone addiction') || addictions.includes('Social media addiction')) {
    patternsTags = ['Dopamine Detoxing', 'Attention Reclaiming', 'Screen Boundaries'];
  } else if (addictions.includes('Overthinking') || addictions.includes('Negative self-talk')) {
    patternsTags = ['Quiet Mind', 'Conquering Paralysis', 'Action Over Perfect'];
  } else {
    patternsTags = ['High Attention Span', 'Flow State Access', 'Peak Focus'];
  }

  // 3. Struggles Insight (Whats Holding You Back Page)
  const strugglesList = [];

  if (addictions.includes('Constant procrastination')) {
    strugglesList.push({
      title: 'Procrastination Avoidance Loops',
      desc: 'You delay high-impact tasks not out of laziness, but due to subconscious dread. The task feels massive, so your brain seeks immediate emotional relief in minor distractions. We will neutralize this by introducing 5-minute activation triggers.',
      icon: 'clock'
    });
  }
  if (addictions.includes('Late-night scrolling') || state.sessionData.flow_responses.sleep_state?.includes('Poor')) {
    strugglesList.push({
      title: 'Revenge Bedtime Procrastination',
      desc: 'You stay up late scrolling because it is the only part of the day where you feel fully in control of your time. However, this midnight tax destroys the next day\'s energy reserves. We will replace this with a luxurious evening wind-down protocol.',
      icon: 'moon'
    });
  }
  if (routine.includes('chaotic') || routine.includes('different') || routine.includes('almost no')) {
    strugglesList.push({
      title: 'Reactive Decision Fatigue',
      desc: 'Because your days lack a predictable skeletal skeleton, you must constantly decide what to do next. This exhausts your willpower before you even begin working. We will systemize your mornings so focus becomes automatic.',
      icon: 'compass'
    });
  }
  if (addictions.includes('Overthinking') || addictions.includes('Negative self-talk')) {
    strugglesList.push({
      title: 'Analysis Paralysis Gates',
      desc: 'You spend so much energy designing the perfect plan that you exhaust your activation energy. You must learn to value imperfect, dirty actions over clean stagnation. We will prioritize consistency over perfection.',
      icon: 'brain'
    });
  }
  if (energy.includes('Mentally exhausted')) {
    strugglesList.push({
      title: 'Cognitive Battery Depletion',
      desc: 'Your mind is running on low voltage, making even simple tasks feel like climbing a mountain. Pushing for high performance right now is a trap that will lead to burnout. We will prioritize recovery and steady progress.',
      icon: 'battery-low'
    });
  }

  // Fallbacks if list is empty
  while (strugglesList.length < 3) {
    if (strugglesList.length === 0) {
      strugglesList.push({
        title: 'Motivation Dependency',
        desc: 'Relying on emotional spikes to do hard things instead of establishing stable, automatic daily systems. We will build habit consistency that functions independently of your mood.',
        icon: 'zap'
      });
    } else if (strugglesList.length === 1) {
      strugglesList.push({
        title: 'Focus Fragmentation Leaks',
        desc: 'Erratic notification checks and shifting browser tabs micro-slice your focus, taking you out of flow states. We will isolate your attention during high-impact blocks.',
        icon: 'smartphone'
      });
    } else {
      strugglesList.push({
        title: 'Vague Priority Drift',
        desc: 'Trying to work on everything at once without a singular, dominant focus point. We will narrow your scope to build massive compounding force on a single target.',
        icon: 'target'
      });
    }
  }

  return {
    mindset: { title: mindsetTitle, text: mindsetText, tags: mindsetTags },
    patterns: { title: patternsTitle, text: patternsText, tags: patternsTags },
    struggles: strugglesList.slice(0, 3)
  };
}

// SCREEN: Immersive AI Loading Screen
function renderAiAnalysisLoading(viewWrap) {
  viewWrap.className = 'page-view';
  viewWrap.innerHTML = `
    <div class="ai-loading-container">
      <div class="ai-loader-concentric">
        <div class="orbit-ring outer"></div>
        <div class="orbit-ring middle"></div>
        <div class="orbit-ring inner"></div>
        <span class="ai-loader-percentage" id="loader-pct">0%</span>
      </div>
      <div class="ai-status-pulse-text" id="loader-status">Analyzing your patterns...</div>
    </div>
  `;

  const pct = viewWrap.querySelector('#loader-pct');
  const status = viewWrap.querySelector('#loader-status');

  const statusTexts = [
    "Analyzing your patterns...",
    "Understanding your habits and mindset...",
    "Building your personal growth profile...",
    "Identifying hidden obstacles...",
    "Generating your transformation roadmap..."
  ];

  let currentPercent = 0;
  let statusIndex = 0;

  // Pulse animation loop
  const interval = setInterval(() => {
    currentPercent += Math.floor(Math.random() * 8) + 3;
    if (currentPercent >= 100) {
      currentPercent = 100;
      clearInterval(interval);
      pct.innerText = `100%`;
      status.innerText = "Growth profile synthesized.";
      setTimeout(() => {
        advanceStep();
      }, 800);
    } else {
      pct.innerText = `${currentPercent}%`;
      // Smoothly transition loading texts based on percentage milestones
      const targetIndex = Math.min(statusTexts.length - 1, Math.floor((currentPercent / 100) * statusTexts.length));
      if (targetIndex !== statusIndex) {
        statusIndex = targetIndex;
        status.style.opacity = 0;
        setTimeout(() => {
          status.innerText = statusTexts[statusIndex];
          status.style.opacity = 1;
        }, 200);
      }
    }
  }, 150);
}

// SCREEN: "How We See You" Analysis Screen
function renderHowWeSeeYou(viewWrap) {
  const analysis = generateAIPersonalityAnalysis();
  const info = state.sessionData.basic_info;

  viewWrap.innerHTML = `
    <div class="question-header">
      <span class="question-pre">Cognitive Synthesis</span>
      <h2 class="question-title">How We See You</h2>
      <p class="question-desc">Based on your answers, this is the version of you we currently see.</p>
    </div>

    <p class="analysis-intro-text">
      Alexander, your responses paint a clear picture of a highly self-aware individual. You have recognized where your daily routines break down, and you have taken the first step by deconstructing the habits holding you back. Here is your baseline profile:
    </p>

    <div class="analysis-grid">
      <!-- Card 1: Mindset -->
      <div class="analysis-card mindset-card glow-card">
        <div class="analysis-card-title">
          <i data-lucide="brain" style="color: var(--accent-purple);"></i>
          <span>${analysis.mindset.title}</span>
        </div>
        <p class="analysis-card-text">${analysis.mindset.text}</p>
        <div class="analysis-tags">
          ${analysis.mindset.tags.map(t => `<span class="analysis-tag">${t}</span>`).join('')}
        </div>
      </div>

      <!-- Card 2: Patterns -->
      <div class="analysis-card patterns-card glow-card">
        <div class="analysis-card-title">
          <i data-lucide="activity" style="color: var(--accent-cyan);"></i>
          <span>${analysis.patterns.title}</span>
        </div>
        <p class="analysis-card-text">${analysis.patterns.text}</p>
        <div class="analysis-tags">
          ${analysis.patterns.tags.map(t => `<span class="analysis-tag">${t}</span>`).join('')}
        </div>
      </div>
    </div>

    <div class="action-bar">
      <button id="btn-submit-analysis" class="btn-premium primary">
        <span>Continue to Insight</span>
        <i data-lucide="arrow-right"></i>
      </button>
    </div>
  `;

  lucide.createIcons();
  bindCardGlowListeners();

  viewWrap.querySelector('#btn-submit-analysis').addEventListener('click', () => {
    advanceStep();
  });
}

// SCREEN: "What's Holding You Back" Insights Page
function renderWhatsHoldingYouBack(viewWrap) {
  const analysis = generateAIPersonalityAnalysis();

  viewWrap.innerHTML = `
    <div class="question-header">
      <span class="question-pre">Friction Audit</span>
      <h2 class="question-title">What's Slowing Your Growth</h2>
      <p class="question-desc">We have mapped the primary leaks draining your consistency. Conquering them starts with awareness.</p>
    </div>

    <div class="struggles-layout">
      ${analysis.struggles.map(s => `
        <div class="struggle-item">
          <div class="struggle-icon-box">
            <i data-lucide="${s.icon}"></i>
          </div>
          <div class="struggle-details">
            <span class="struggle-title">${s.title}</span>
            <p class="struggle-desc">${s.desc}</p>
          </div>
        </div>
      `).join('')}
    </div>

    <h3 class="plan-helpers-header">How Your Plan Will Help</h3>

    <div class="plan-helpers-grid">
      <div class="plan-helper-card glow-card">
        <i data-lucide="anchor" class="plan-helper-icon"></i>
        <span class="plan-helper-title">Habit Anchoring</span>
        <p class="plan-helper-desc">Frictionless 5-minute micro-habits that bypass your brain's action resistance.</p>
      </div>

      <div class="plan-helper-card glow-card">
        <i data-lucide="shield" class="plan-helper-icon"></i>
        <span class="plan-helper-title">Friction Insulation</span>
        <p class="plan-helper-desc">Systematic rules to lock out environments and digital loops that trigger procrastination.</p>
      </div>

      <div class="plan-helper-card glow-card">
        <i data-lucide="trending-up" class="plan-helper-icon"></i>
        <span class="plan-helper-title">Consistency Scaling</span>
        <p class="plan-helper-desc">Gradual progression models that increase routine demands only after self-trust stabilizes.</p>
      </div>
    </div>

    <div class="action-bar">
      <button id="btn-submit-struggles" class="btn-premium primary">
        <span>Continue</span>
        <i data-lucide="arrow-right"></i>
      </button>
    </div>
  `;

  lucide.createIcons();
  bindCardGlowListeners();

  viewWrap.querySelector('#btn-submit-struggles').addEventListener('click', () => {
    advanceStep();
  });
}

// SCREEN: "What Most People Never Realize" Psychological commitment page
function renderWhatMostNeverRealize(viewWrap) {
  viewWrap.innerHTML = `
    <div class="question-header">
      <span class="question-pre">Stoic Truth</span>
      <h2 class="question-title">What Most People Never Realize</h2>
      <p class="question-desc">Personal growth fails because we rely on the wrong systems.</p>
    </div>

    <div class="realization-layout">
      <!-- Left side: The Stagnation Loop -->
      <div class="stagnation-timeline">
        <span class="stagnation-title">The Stagnation Loop</span>
        
        <div class="stagnation-step">
          <div class="stagnation-dot">1</div>
          <div class="stagnation-details">
            <span class="stagnation-step-title">Motivation Hype</span>
            <p class="stagnation-step-desc">A burst of emotional drive sparks the desire to change everything overnight.</p>
          </div>
        </div>

        <div class="stagnation-step">
          <div class="stagnation-dot">2</div>
          <div class="stagnation-details">
            <span class="stagnation-step-title">Sudden Friction</span>
            <p class="stagnation-step-desc">Life gets busy, fatigue kicks in, and the initial excitement evaporates.</p>
          </div>
        </div>

        <div class="stagnation-step">
          <div class="stagnation-dot">3</div>
          <div class="stagnation-details">
            <span class="stagnation-step-title">Consistency Crash</span>
            <p class="stagnation-step-desc">Missing a habit triggers a guilt spiral. The routine is completely abandoned.</p>
          </div>
        </div>

        <div class="stagnation-step">
          <div class="stagnation-dot">4</div>
          <div class="stagnation-details">
            <span class="stagnation-step-title">Stagnation Loop</span>
            <p class="stagnation-step-desc">You return exactly to where you started, waiting for the next spark of motivation.</p>
          </div>
        </div>
      </div>

      <!-- Right side: Why you are already ahead -->
      <div class="realization-details">
        <span class="realization-header">Why you are already breaking the cycle.</span>
        <p class="realization-text">
          95% of people quit because they rely on emotional inspiration to do hard things. They build massive plans but build zero self-awareness. By choosing to deconstruct your day honestly, you have already bypassed the first gate:
        </p>

        <div class="advantage-item">
          <i data-lucide="eye" class="advantage-icon"></i>
          <div class="advantage-content">
            <span class="advantage-title">Radical Self-Awareness</span>
            <p class="stagnation-step-desc">You did not look for quick hacks. You audited your routine, sleep, and environment honestly.</p>
          </div>
        </div>

        <div class="advantage-item">
          <i data-lucide="sliders" class="advantage-icon"></i>
          <div class="advantage-content">
            <span class="advantage-title">Analytical Intent</span>
            <p class="stagnation-step-desc">We know exactly what drains your cognitive battery. We can insulate you from leaks systematically.</p>
          </div>
        </div>

        <div class="advantage-item">
          <i data-lucide="lock" class="advantage-icon"></i>
          <div class="advantage-content">
            <span class="advantage-title">Habits Over Hype</span>
            <p class="stagnation-step-desc">We are not building a motivation plan. We are assembling a resilient habits system.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="action-bar">
      <button id="btn-submit-realize" class="btn-premium primary">
        <span>Preview Your Transformation</span>
        <i data-lucide="arrow-right"></i>
      </button>
    </div>
  `;

  lucide.createIcons();

  viewWrap.querySelector('#btn-submit-realize').addEventListener('click', () => {
    advanceStep();
  });
}

// SCREEN: "Your Transformation Preview" interactive milestone node
function renderTransformationPreview(viewWrap) {
  const chosen = state.sessionData.focus_areas || [];
  
  // Custom milestones based on focus areas
  const milestoneDetails = [
    {
      days: "Days 1-7",
      title: "Base Synchronization",
      desc: "We will establish circular sleep synchronization and frictionless morning triggers. Your only task is starting—building initial momentum with zero routine resistance.",
      icon: "activity"
    },
    {
      days: "Days 8-21",
      title: "Focus Insulation",
      desc: "We will systematically isolate you from digital dopamine loops and phone distraction triggers during high-impact blocks. We block cognitive friction before it drains you.",
      icon: "shield"
    },
    {
      days: "Days 22-45",
      title: "Willpower Autopilot",
      desc: "Habit systems compound. Action triggers shift from conscious willpower effort to automatic, neurological reflexes. The daily routine operates smoothly on auto-pilot.",
      icon: "zap"
    },
    {
      days: "Days 46+",
      title: "Peak Ascent Scaling",
      desc: "We compound your consistency to scale major lifetime goals. Circadian resting and Stoic habit loops are fully established, giving you ultimate sovereignty and autonomy.",
      icon: "target"
    }
  ];

  viewWrap.innerHTML = `
    <div class="question-header">
      <span class="question-pre">Habit Evolution</span>
      <h2 class="question-title">Your Transformation starts here</h2>
      <p class="question-desc">Click each milestone phase below to preview the progression of your KAIROS ascent protocol.</p>
    </div>

    <div class="preview-timeline">
      ${milestoneDetails.map((m, idx) => `
        <div class="timeline-node ${idx === 0 ? 'active' : ''}" data-idx="${idx}">
          <div class="timeline-node-icon">
            <i data-lucide="${m.icon}"></i>
          </div>
          <span class="timeline-node-days">${m.days}</span>
          <span class="timeline-node-title">${m.title}</span>
        </div>
      `).join('')}
    </div>

    <!-- Active Details Display Box -->
    <div class="preview-detail-card" id="detail-card">
      <div class="preview-detail-icon-box" id="detail-icon-box">
        <i data-lucide="${milestoneDetails[0].icon}"></i>
      </div>
      <div class="preview-detail-content">
        <span class="preview-detail-header" id="detail-header">${milestoneDetails[0].days}</span>
        <span class="preview-detail-title" id="detail-title">${milestoneDetails[0].title}</span>
        <p class="preview-detail-desc" id="detail-desc">${milestoneDetails[0].desc}</p>
      </div>
    </div>

    <div class="action-bar">
      <button id="btn-submit-preview" class="btn-premium primary">
        <span>Generate Ascent Roadmap</span>
        <i data-lucide="sparkles"></i>
      </button>
    </div>
  `;

  lucide.createIcons();

  const nodes = viewWrap.querySelectorAll('.timeline-node');
  const dCard = viewWrap.querySelector('#detail-card');
  const dIconBox = viewWrap.querySelector('#detail-icon-box');
  const dHeader = viewWrap.querySelector('#detail-header');
  const dTitle = viewWrap.querySelector('#detail-title');
  const dDesc = viewWrap.querySelector('#detail-desc');

  nodes.forEach(node => {
    node.addEventListener('click', () => {
      nodes.forEach(n => n.classList.remove('active'));
      node.classList.add('active');

      const idx = parseInt(node.getAttribute('data-idx'));
      const details = milestoneDetails[idx];

      // Smooth content fade shift
      dCard.style.opacity = 0;
      dCard.style.transform = 'translateY(5px)';
      
      setTimeout(() => {
        dIconBox.innerHTML = `<i data-lucide="${details.icon}"></i>`;
        dHeader.innerText = details.days;
        dTitle.innerText = details.title;
        dDesc.innerText = details.desc;
        lucide.createIcons();
        
        dCard.style.opacity = 1;
        dCard.style.transform = 'translateY(0)';
      }, 200);
    });
  });

  viewWrap.querySelector('#btn-submit-preview').addEventListener('click', () => {
    advanceStep();
  });
}

// SCREEN 14: Algorithmic Roadmap Synthesis Screen
function renderRoadmapScreen(viewWrap) {
  // First, generate the algorithmically tailored self-improvement roadmap
  const roadmap = compileAlgorithmRoadmap();
  state.sessionData.generated_roadmap = roadmap;
  
  // Show breathing loading sequence first to simulate high-end "AI Processing" calculations
  viewWrap.className = 'page-view roadmap-loading-container';
  viewWrap.innerHTML = `
    <div class="roadmap-loading">
      <div class="spinner-ring"></div>
      <span class="loading-text" id="loading-txt">Synthesizing personal life blueprint...</span>
    </div>
  `;
  
  // Stepwise breathing text animations
  const stepsTexts = [
    "Synthesizing personal life blueprint...",
    "Aligning micro-habits to focus vectors...",
    "Injecting Stoic optimization logic...",
    "Calibrating circadian sleep triggers...",
    "Roadmap complete. Aligning entry pathways..."
  ];
  
  let txtIdx = 0;
  const txtInterval = setInterval(() => {
    const el = viewWrap.querySelector('#loading-txt');
    if (!el) {
      clearInterval(txtInterval);
      return;
    }
    txtIdx = Math.min(stepsTexts.length - 1, txtIdx + 1);
    el.innerText = stepsTexts[txtIdx];
  }, 1000);
  
  // Persist session to database (IndexedDB)
  saveSession(state.sessionData)
    .then(() => {
      updateDBInspectorBadge();
    })
    .catch(err => console.error("Database Save Failed:", err));
  
  setTimeout(() => {
    clearInterval(txtInterval);
    
    // Smooth fade into final custom visual roadmap card
    viewWrap.innerHTML = `
      <div class="roadmap-container">
        <div class="pulse-sparkle-box">
          <i data-lucide="sparkles"></i>
        </div>
        
        <span class="roadmap-badge">Onboarding Complete</span>
        <h2 class="welcome-title" style="font-size: 38px; letter-spacing:-1px;">Your Journey Starts Now</h2>
        <p class="welcome-subtitle" style="font-size: 15px; margin-bottom: 0;">Welcome, ${state.sessionData.basic_info.first_name}. We have customized a dynamic ascent model for your life.</p>
        
        <div class="roadmap-card">
          <div class="roadmap-archetype">Archetype: ${roadmap.archetype}</div>
          <h3 class="roadmap-title">${roadmap.stage_1.split(':')[0]}</h3>
          <p class="roadmap-desc">${roadmap.letter}</p>
          
          <div class="roadmap-steps-list">
            <div class="roadmap-step-item">
              <div class="step-num-node">I</div>
              <div class="step-details">
                <span class="step-title">${roadmap.stage_1}</span>
                <p class="step-summary">Focuses on resetting physical and cognitive baselines immediately.</p>
              </div>
            </div>
            
            <div class="roadmap-step-item">
              <div class="step-num-node">II</div>
              <div class="step-details">
                <span class="step-title">${roadmap.stage_2}</span>
                <p class="step-summary">Establishes anchors to isolate concentration blocks and block friction leaks.</p>
              </div>
            </div>
            
            <div class="roadmap-step-item">
              <div class="step-num-node">III</div>
              <div class="step-details">
                <span class="step-title">${roadmap.stage_3}</span>
                <p class="step-summary">Compounds consistency loops to form automatic, resilient reflexes.</p>
              </div>
            </div>
            
            <div class="roadmap-step-item">
              <div class="step-num-node">IV</div>
              <div class="step-details">
                <span class="step-title">${roadmap.stage_4}</span>
                <p class="step-summary">Unlocks peak leverage scaling in career, financials, or elite physical domains.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div class="action-bar">
          <button id="btn-enter-life" class="btn-premium primary" style="min-width: 250px;">
            <span>Enter Your New Life</span>
            <i data-lucide="shield-check"></i>
          </button>
        </div>
      </div>
      
      <!-- Fullscreen white transition element -->
      <div id="flash-overlay" class="fullscreen-enter-flash"></div>
    `;
    
    lucide.createIcons();
    
    // Fullscreen light beam transition event
    viewWrap.querySelector('#btn-enter-life').addEventListener('click', () => {
      const flash = viewWrap.querySelector('#flash-overlay');
      if (flash) {
        flash.classList.add('active');
        
        // Loop back to start welcome screen after full visual flash
        setTimeout(() => {
          initializeState();
          renderActiveStep();
        }, 1500);
      }
    });
    
  }, 4200); // Process loading duration
}

function compileAlgorithmRoadmap() {
  const info = state.sessionData.basic_info;
  const stateVal = state.sessionData.life_state;
  const chosenAreas = state.sessionData.focus_areas;
  const flowAns = state.sessionData.flow_responses;
  
  // Retrieve new onboarding parameters
  const genAns = state.sessionData.general_responses;
  const values = genAns.values_priorities || [];
  const environment = genAns.daily_environment || [];
  const confidence = genAns.routine_confidence || 5;
  const addictions = genAns.addictions_distractions || [];
  const challenge = genAns.challenge_intensity || 'Balanced Growth';
  const energy = genAns.personality_energy || 'Quietly determined';
  const vision = genAns.future_self_vision || [];
  const mindset = genAns.final_mindset || 'A complete personal transformation';
  const identityVal = genAns.identity || '';

  // 1. Archetype synthesis
  let archetype = 'The Centered Pathfinder';
  if (mindset.includes('complete personal transformation') || energy.includes('Ready for a complete transformation')) {
    archetype = 'The Phoenix Ascendant';
  } else if (mindset.includes('peaceful and balanced') || energy.includes('Mentally exhausted')) {
    archetype = 'The Stoic Alchemist';
  } else if (mindset.includes('disciplined and successful') || energy.includes('Disciplined and focused')) {
    archetype = 'The Sovereign Achiever';
  } else if (mindset.includes('healthy and energetic')) {
    archetype = 'The Vitality Sovereign';
  } else if (mindset.includes('meaningful and purposeful') || energy.includes('Lost and directionless')) {
    archetype = 'The Purpose Pathfinder';
  } else if (mindset.includes('confident and respected')) {
    archetype = 'The Unshakable Pillar';
  } else {
    // Fallback
    if (stateVal.includes('improve yourself') || identityVal.includes('high-performance') || identityVal.includes('full potential')) {
      archetype = 'The Sovereign Optimizer';
    } else if (stateVal.includes('okay, but') || identityVal.includes('disciplined')) {
      archetype = 'The Dynamic Architect';
    } else if (stateVal.includes('exhausted') || stateVal.includes('stuck') || identityVal.includes('rebuild')) {
      archetype = 'The Resilient Ascendant';
    }
  }
  
  // 2. Custom letter crafting
  let letter = `Welcome to the KAIROS ascent protocol, ${info.first_name}. `;
  
  // Contextual drivers
  if (values.length > 0) {
    letter += `Your deep driving vectors are anchored in ${values.slice(0, 2).join(' and ')}. `;
  } else {
    letter += `Your focus is set on optimizing your daily lifestyle pillars. `;
  }
  
  // Confidence & environment calibration
  letter += `With a self-trust level of ${confidence}/10, we will calibrate your habit intensity to `;
  if (confidence <= 3) {
    letter += `eliminate initial friction, focusing on tiny, high-activation micro-wins. `;
  } else if (confidence <= 6) {
    letter += `establish consistent, mid-density daily anchors that fit cleanly around your occupation. `;
  } else {
    letter += `immediately stack advanced high-performance protocols. `;
  }

  // Environment and distractions obstacles
  if (addictions.length > 0 && !addictions.includes('None of these')) {
    letter += `We have recognized that hurdles like ${addictions.slice(0, 2).join(' & ')} currently leak your attention. We will systematically insulate you from these. `;
  } else if (addictions.includes('None of these')) {
    letter += `You enter this cycle free of heavy habit drag, giving us clean leverage for rapid optimization. `;
  }

  // Vision mapping
  if (vision.length > 0) {
    letter += `Within the next 12 months, your efforts will focus on compounding changes in your ${vision.slice(0, 2).join(' and ')} to construct ${mindset.toLowerCase().replace('a ', '')}. `;
  }

  // Challenge closing remarks
  if (challenge === 'Elite Challenge Mode') {
    letter += `Elite mode enabled: prepare for absolute stoic accountability, deliberate friction, and deep character refinement. Let the forge begin.`;
  } else if (challenge === 'Serious Transformation') {
    letter += `Serious mode enabled: high accountability will transform your consistency into concrete physical results. Stand up and claim it.`;
  } else if (challenge === 'Gentle & Supportive') {
    letter += `Gentle growth mode enabled: sustainable, friction-free changes and rich mindfulness will be your compounding superpowers. Breathe and advance.`;
  } else {
    letter += `Balanced growth mode enabled: steady challenges will scale with your adaptation to guarantee unshakeable habit integration. Ready yourself.`;
  }
  
  // 3. Stage compilation
  let stage1 = 'Circadian Synchronization & Vigor';
  let stage2 = 'Attention Anchoring & Shields';
  let stage3 = 'Compounding Daily Reflex Loops';
  let stage4 = 'Peak System Scaling & Autonomy';
  
  // Dynamic prefixes based on challenge intensity
  let challengePrefix1 = '';
  let challengePrefix2 = '';
  let challengePrefix3 = '';
  let challengePrefix4 = '';
  
  if (challenge === 'Elite Challenge Mode') {
    challengePrefix1 = 'Aggressive ';
    challengePrefix2 = 'Hyper-Insulated ';
    challengePrefix3 = 'Military-Grade ';
    challengePrefix4 = 'Autonomous Sovereign ';
  } else if (challenge === 'Serious Transformation') {
    challengePrefix1 = 'Accountable ';
    challengePrefix2 = 'Isolate ';
    challengePrefix3 = 'Compounded ';
    challengePrefix4 = 'High-Performance ';
  }

  if (chosenAreas.includes('Physical Health & Fitness')) {
    stage1 = challengePrefix1 + 'Circadian Reset & Dynamic Movement';
  }
  if (chosenAreas.includes('Sleep & Energy') && flowAns.sleep_state && flowAns.sleep_state.includes('Poor')) {
    stage1 = challengePrefix1 + 'Circadian Sync & Sleep Routine Setup';
  }
  
  if (chosenAreas.includes('Focus & Productivity') || chosenAreas.includes('Education & Learning')) {
    stage2 = challengePrefix2 + 'Attention Anchoring & Distraction Shielding';
  }
  
  if (chosenAreas.includes('Discipline & Consistency') || chosenAreas.includes('Motivation & Purpose')) {
    stage3 = challengePrefix3 + 'Stoic Habit Loops & Friction Elimination';
  }
  
  if (chosenAreas.includes('Relationships & Social Life')) {
    stage3 = challengePrefix3 + 'Empathy Rings & Social Boundaries';
  }
  
  if (chosenAreas.includes('Career & Financial Growth')) {
    stage4 = challengePrefix4 + 'Elite Professional Performance & Asset Scaling';
  }
  
  return {
    archetype,
    letter,
    stage_1: stage1,
    stage_2: stage2,
    stage_3: stage3,
    stage_4: stage4
  };
}

// --- Navigation Controller Hook-ins ---
function advanceStep() {
  if (state.currentStepIndex < state.activeQueue.length - 1) {
    state.currentStepIndex++;
    renderActiveStep();
  }
}

function handleBackNavigation() {
  if (state.currentStepIndex > 0) {
    // If the step is sleep_support, and sleep_state was altered, remove sleep_support on back
    const prevNode = state.activeQueue[state.currentStepIndex - 1];
    state.currentStepIndex--;
    renderActiveStep();
  }
}

function registerNavigationListeners() {
  const btnBack = document.getElementById('btn-back');
  const btnReset = document.getElementById('btn-reset');
  
  if (btnBack) {
    btnBack.addEventListener('click', handleBackNavigation);
  }
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm("Reset onboarding? This resets current progress data.")) {
        initializeState();
        renderActiveStep();
      }
    });
  }
}

// --- Live Database Inspector Panel Logic ---
function initDBInspectorController() {
  const panel = document.getElementById('db-inspector');
  const btnToggle = document.getElementById('btn-db-toggle');
  const btnClose = document.getElementById('btn-db-close');
  const btnRefresh = document.getElementById('btn-db-refresh');
  const btnClear = document.getElementById('btn-db-clear');
  const btnCopy = document.getElementById('btn-db-copy-json');
  
  let inspectorSessions = [];
  let selectedSessionId = '';
  
  const togglePanel = () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      loadDBRecords();
    }
  };
  
  if (btnToggle) btnToggle.addEventListener('click', togglePanel);
  if (btnClose) btnClose.addEventListener('click', togglePanel);
  
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadDBRecords();
      btnRefresh.querySelector('i').classList.add('rotate-cw');
      setTimeout(() => {
        btnRefresh.querySelector('i').classList.remove('rotate-cw');
      }, 500);
    });
  }
  
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (confirm("Are you sure you want to completely erase the client-side IndexedDB database?")) {
        clearDatabase()
          .then(() => {
            loadDBRecords();
            updateDBInspectorBadge();
          })
          .catch(err => console.error("Database wipe failed:", err));
      }
    });
  }
  
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const codeBox = document.getElementById('db-json-code');
      if (codeBox) {
        navigator.clipboard.writeText(codeBox.innerText)
          .then(() => {
            const originalHTML = btnCopy.innerHTML;
            btnCopy.innerHTML = `<i data-lucide="check"></i> Copied!`;
            lucide.createIcons();
            setTimeout(() => {
              btnCopy.innerHTML = originalHTML;
              lucide.createIcons();
            }, 1500);
          })
          .catch(err => console.error("Clipboard copy failed:", err));
      }
    });
  }
  
  function loadDBRecords() {
    getSessions()
      .then(sessions => {
        inspectorSessions = sessions;
        renderDBRecordsTable(sessions);
      })
      .catch(err => console.error("Could not fetch sessions for inspector:", err));
  }
  
  function renderDBRecordsTable(sessions) {
    const tbody = document.getElementById('db-records-body');
    const codePre = document.getElementById('db-json-code');
    
    if (sessions.length === 0) {
      tbody.innerHTML = `
        <tr class="db-empty-row">
          <td colspan="4">No sessions stored in database yet.</td>
        </tr>
      `;
      codePre.innerText = `// Select a session row above to inspect the fully branched database structure...`;
      selectedSessionId = '';
      return;
    }
    
    tbody.innerHTML = sessions.map(sess => {
      const date = new Date(sess.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const name = sess.basic_info.first_name || 'Anonymous';
      const arch = sess.generated_roadmap.archetype || 'Pending Synthesis';
      const isSel = sess.id === selectedSessionId;
      
      return `
        <tr class="${isSel ? 'active-row' : ''}" data-id="${sess.id}">
          <td>${date}</td>
          <td><strong>${name}</strong></td>
          <td><span style="color: var(--accent-cyan); font-size:10px;">${arch}</span></td>
          <td><button class="db-btn-view">View</button></td>
        </tr>
      `;
    }).join('');
    
    // Bind click listeners on table rows
    const rows = tbody.querySelectorAll('tr:not(.db-empty-row)');
    rows.forEach(row => {
      row.addEventListener('click', () => {
        rows.forEach(r => r.classList.remove('active-row'));
        row.classList.add('active-row');
        
        const id = row.getAttribute('data-id');
        selectedSessionId = id;
        
        const session = inspectorSessions.find(s => s.id === id);
        if (session) {
          codePre.innerText = JSON.stringify(session, null, 2);
        }
      });
    });
  }
}

function updateDBInspectorBadge() {
  getSessions()
    .then(sessions => {
      const count = sessions.length;
      const badges = document.querySelectorAll('#db-badge, #db-stat-count');
      badges.forEach(b => {
        b.innerText = count;
      });
    })
    .catch(err => console.error("Could not sync DB count:", err));
}

// --- App Entry Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Canvas Background Engine
  initAmbientCanvas();
  
  // 2. Initialize database
  initDatabase()
    .then(() => {
      // 3. Setup global application state
      initializeState();
      
      // 4. Bind static navigation and drawer actions
      registerNavigationListeners();
      initDBInspectorController();
      
      // 5. Render sign-in page
      renderActiveStep();
    })
    .catch(err => {
      console.error("IndexedDB initialisation failed, fallback in place:", err);
      // Fallback without IndexedDB persistence (runs in memory)
      initializeState();
      registerNavigationListeners();
      initDBInspectorController();
      renderActiveStep();
    });
});
