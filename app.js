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
  const universalEndNodes = ['routine', 'reflection_progress', 'reflection_pride', 'identity', 'final_roadmap'];
  
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
        return `
          <div class="glow-card ${isSel ? 'selected' : ''}" data-value="${opt.text}">
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
        if (chosenArray.includes(val)) {
          chosenArray = chosenArray.filter(v => v !== val);
          card.classList.remove('selected');
        } else {
          chosenArray.push(val);
          card.classList.add('selected');
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

// Algorithmic synthesis details
function compileAlgorithmRoadmap() {
  const info = state.sessionData.basic_info;
  const stateVal = state.sessionData.life_state;
  const identVal = state.sessionData.general_responses.identity;
  const chosenAreas = state.sessionData.focus_areas;
  const flowAns = state.sessionData.flow_responses;
  
  // 1. Archetype synthesis
  let archetype = 'The Centered Pathfinder';
  if (stateVal.includes('improve yourself') || identVal.includes('high-performance') || identVal.includes('full potential')) {
    archetype = 'The Sovereign Optimizer';
  } else if (stateVal.includes('okay, but') || identVal.includes('disciplined')) {
    archetype = 'The Dynamic Architect';
  } else if (stateVal.includes('exhausted') || stateVal.includes('stuck') || identVal.includes('rebuild')) {
    archetype = 'The Resilient Ascendant';
  }
  
  // 2. Custom letter crafting
  let letter = `Your responses indicate you are ready to undergo a profound reinvention. By targeting `;
  if (chosenAreas.length > 0) {
    letter += chosenAreas.slice(0, 3).join(', ') + `, we will establish structural boundaries around your day. `;
  } else {
    letter += `your key habit pillars, we will lay down structural anchors. `;
  }
  
  if (flowAns.fitness_obstacle) {
    letter += `We have recognized that "${flowAns.fitness_obstacle}" has stalled your momentum. We will neutralize this early in Stage I. `;
  }
  
  if (flowAns.sleep_state && flowAns.sleep_state.includes('Poor')) {
    letter += `Furthermore, prioritizing evening circadian resets will be a major catalyst to restore your focus reserves. `;
  } else {
    letter += `Your solid foundation will allow us to immediately launch advanced focus blocks. `;
  }
  
  letter += `Welcome to the KAIROS ascent protocol. Take the first step.`;
  
  // 3. Stage compilation
  let stage1 = 'Circadian Synchronization & Vigor';
  let stage2 = 'Attention Anchoring & Shields';
  let stage3 = 'Compounding Daily Reflex Loops';
  let stage4 = 'Peak System Scaling & Autonomy';
  
  if (chosenAreas.includes('Physical Health & Fitness')) {
    stage1 = 'Circadian Reset & Dynamic Movement';
  }
  if (chosenAreas.includes('Sleep & Energy') && flowAns.sleep_state && flowAns.sleep_state.includes('Poor')) {
    stage1 = 'Circadian Sync & Sleep Routine Setup';
  }
  
  if (chosenAreas.includes('Focus & Productivity') || chosenAreas.includes('Education & Learning')) {
    stage2 = 'Attention Anchoring & Distraction Shielding';
  }
  
  if (chosenAreas.includes('Discipline & Consistency') || chosenAreas.includes('Motivation & Purpose')) {
    stage3 = 'Stoic Habit Loops & Friction Elimination';
  }
  
  if (chosenAreas.includes('Relationships & Social Life')) {
    stage3 = 'Empathy Rings & Social Boundaries';
  }
  
  if (chosenAreas.includes('Career & Financial Growth')) {
    stage4 = 'Elite Professional Performance & Asset Scaling';
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
