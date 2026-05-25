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
    generated_roadmap: {},
    dashboard_offers: {}
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
    subtitle: '',
    options: [
      { id: 'focus_gym', text: 'Gym & Fitness Training', desc: 'Strength, stamina, and workout consistency.', icon: 'activity' },
      { id: 'focus_diet', text: 'Diet & Nutrition Balance', desc: 'Caloric tracking, meal scheduling, and cleaner eating habits.', icon: 'apple' },
      { id: 'focus_sleep', text: 'Sleep & Circadian Rhythm', desc: 'Fixing sleep schedules, deep rest, and wind-down routines.', icon: 'moon' },
      { id: 'focus_discipline', text: 'Focus, Discipline & Study', desc: 'Beating procrastination, time management, and building deep study habits.', icon: 'zap' },
      { id: 'focus_mental', text: 'Mental Health & Inner Peace', desc: 'Mindfulness, managing anxiety, and reducing daily stress.', icon: 'heart' },
      { id: 'focus_relationships', text: 'Relationships & Social Life', desc: 'Family bonds, deep friendships, and social presence.', icon: 'users' }
    ],
    save: (vals) => {
      state.sessionData.focus_areas = vals;
      buildDynamicQueue();
    }
  },

  // CONDITIONAL ADAPTIVE BRANCH NODES
  fitness_activity: {
    type: 'single',
    title: 'What is your current physical activity level?',
    subtitle: '',
    options: [
      { id: 'fit_act_sedentary', text: 'Sedentary', desc: 'Rare movement, mostly desk-bound or stationary.', icon: 'coffee' },
      { id: 'fit_act_lightly', text: 'Lightly Active', desc: 'Occasional walks, active housework, or light chores.', icon: 'compass' },
      { id: 'fit_act_moderately', text: 'Moderately Active', desc: '3 to 5 deliberate training sessions per week.', icon: 'activity' },
      { id: 'fit_act_very', text: 'Very Active', desc: 'Daily rigorous athletics, sports, or high-physical occupations.', icon: 'zap' }
    ],
    save: (val) => {
      state.sessionData.basic_info.activity_level = val;
      state.sessionData.flow_responses.fitness_activity = val;
    }
  },
  
  relationship_status: {
    type: 'single',
    title: 'What is your current relationship focus?',
    subtitle: '',
    options: [
      { id: 'rel_stat_single', text: 'Single', desc: 'Focusing on building personal autonomy and self-sovereignty.', icon: 'user' },
      { id: 'rel_stat_dating', text: 'In a relationship', desc: 'Navigating companionship, deep sharing, and mutual growth.', icon: 'heart' },
      { id: 'rel_stat_married', text: 'Married', desc: 'Sustaining long-term commitment, family, and shared Stoic values.', icon: 'shield' },
      { id: 'rel_stat_self', text: 'Focus on self', desc: 'Intentionally isolating attention to perform deep resets.', icon: 'target' }
    ],
    save: (val) => {
      state.sessionData.basic_info.relationship_status = val;
      state.sessionData.flow_responses.relationship_status = val;
    }
  },
  
  // 1. GYM & FITNESS TRAINING (Strictly Conditional)
  gym_q1: {
    type: 'single',
    title: "What does your current workout environment look like?",
    subtitle: "",
    options: [
      { id: 'gym_q1_comm', text: "I go to a commercial gym facility.", desc: "Access to machines, free weights, and dedicated lifting spaces.", icon: 'building' },
      { id: 'gym_q1_home', text: "I do home workouts / bodyweight routines.", desc: "Training in your own space with minimal or bodyweight equipment.", icon: 'home' },
      { id: 'gym_q1_outdoors', text: "I train outdoors / do sports or calisthenics.", desc: "Using parks, track facilities, or bodyweight bars.", icon: 'compass' },
      { id: 'gym_q1_inactive', text: "I am currently completely inactive.", desc: "Looking to build standard movement habits from scratch.", icon: 'coffee' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.gym_q1 = val;
      buildDynamicQueue();
    }
  },

  gym_q2_pushback: {
    type: 'single',
    title: "Could you realistically start incorporating workouts into your weekly routine?",
    subtitle: "",
    options: [
      { id: 'gym_q2_pb_yes', text: "Yes.", desc: "I am ready to allocate time and effort for consistency.", icon: 'check-circle' },
      { id: 'gym_q2_pb_no', text: "No.", desc: "I refuse to train or cannot allocate any mental space.", icon: 'x-circle' },
      { id: 'gym_q2_pb_compromise', text: "I don't want to do it, but I could if it actually improves my health or fitness.", desc: "Willing to try if the evidence and health benefits are clear.", icon: 'help-circle' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.gym_q2_pushback = val;
      buildDynamicQueue();
    }
  },

  gym_mogging: {
    type: 'custom',
    render: (viewWrap) => {
      const gender = state.sessionData?.basic_info?.gender || '';
      let mogText = "YOU SURE YOU WANNA IMPROVE YOUR FITNESS OR YOU JUST PLAYING GAMES WITH THE APP?";
      if (gender === 'Male') {
        mogText = "YOU SURE YOU WANNA IMPROVE YOUR FITNESS OR YOU JUST HAVING FUN WITH THE APP YOU LITTLE BITCH?";
      } else if (gender === 'Female') {
        mogText = "YOU SURE YOU WANNA IMPROVE YOUR FITNESS OR YOU JUST HAVING FUN WITH THE APP YOU LITTLE LAZY PRINCESS?";
      } else if (gender === 'Non-binary' || gender === 'Prefer not to say') {
        mogText = "YOU SURE YOU WANNA IMPROVE YOUR FITNESS OR YOU JUST PLAYING GAMES WITH THE APP?";
      }

      viewWrap.className = 'page-view mogging-screen';
      viewWrap.innerHTML = `
        <div class="mogging-container animate-slide-to-black">
          <div class="mogging-skull-icon">
            <i data-lucide="skull"></i>
          </div>
          <h1 class="mogging-text">
            ${mogText}
          </h1>
          <button id="btn-mogging-reset" class="btn-premium danger mogging-btn">
            <span>[ I will fix up and choose a plan ↺ ]</span>
          </button>
        </div>
      `;
      
      lucide.createIcons();
      
      viewWrap.querySelector('#btn-mogging-reset').addEventListener('click', () => {
        // Resets the Gym branch state
        state.sessionData.flow_responses.gym_q1 = '';
        state.sessionData.flow_responses.gym_q2_pushback = '';
        state.sessionData.flow_responses.gym_q3_adaptation = '';
        state.sessionData.flow_responses.gym_q2 = '';
        
        // Rebuild the queue
        buildDynamicQueue();
        
        // Route back to gym_q1
        const gymQ1Index = state.activeQueue.indexOf('gym_q1');
        if (gymQ1Index !== -1) {
          state.currentStepIndex = gymQ1Index;
        } else {
          state.currentStepIndex = 0; // Fallback
        }
        
        // Animate exit transition and active
        viewWrap.classList.remove('active');
        setTimeout(() => {
          renderActiveStep();
        }, 300);
      });
    }
  },

  gym_q3_adaptation: {
    type: 'single',
    title: "What type of workout can you realistically commit to on a regular basis?",
    subtitle: "",
    options: [
      { id: 'gym_q3_ad_comm', text: "Commercial Gym Training", desc: "Standard machines and structured gym access.", icon: 'building' },
      { id: 'gym_q3_ad_home', text: "Home Workouts / Bodyweight", desc: "No travel friction, training inside your own room.", icon: 'home' },
      { id: 'gym_q3_ad_outdoors', text: "Outdoor Sports & Calisthenics", desc: "Running, outdoor bars, or team sports.", icon: 'compass' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.gym_q3_adaptation = val;
      // Map to gym_q1 for downstream split widgets & metrics
      state.sessionData.flow_responses.gym_q1 = val;
      // Default a low consistency target for active widget splitting fallback
      state.sessionData.flow_responses.gym_q2 = "1–3 days a week.";
      buildDynamicQueue();
    }
  },
  
  gym_q2: {
    type: 'single',
    title: "What's your weekly consistency target?",
    subtitle: "",
    options: [
      { id: 'gym_q2_choice1', text: "1–3 days a week.", desc: "Establishing a low-friction entry point for physical baseline.", icon: 'activity' },
      { id: 'gym_q2_choice2', text: "4–6 days a week.", desc: "Solid, balanced split to build muscle and fitness.", icon: 'calendar' },
      { id: 'gym_q2_choice3', text: "7 or more days a week.", desc: "High-frequency regimen with minimal room for systemic recovery.", icon: 'zap' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.gym_q2 = val;
    }
  },

  gym_q3: {
    type: 'multiple',
    get title() {
      const username = state?.sessionData?.basic_info?.first_name || 'my friend';
      return `Alright ${username}, if we're setting up your physical training loop, where do you need guidance?`;
    },
    subtitle: "",
    options: [
      { id: 'gym_q3_sched', text: "I need an absolute weapon of a workout schedule built for my calendar.", desc: "Structured splits designed around your weekly availability.", icon: 'calendar' },
      { id: 'gym_q3_mech', text: "I want to fix my exercise mechanics, form, and lifting execution.", desc: "Detailed form instruction and alignment blueprints.", icon: 'activity' },
      { id: 'gym_q3_account', text: "I need an accountability system to stop skipping sessions.", desc: "Consistency reminders and progress check-in metrics.", icon: 'shield' }
    ],
    save: (vals) => {
      state.sessionData.flow_responses.gym_q3 = vals;
      state.sessionData.dashboard_offers = state.sessionData.dashboard_offers || {};
      if (vals.includes("I need an absolute weapon of a workout schedule built for my calendar.")) {
        state.sessionData.dashboard_offers.fitness = 'Custom Training Split Generator';
      } else if (vals.includes("I want to fix my exercise mechanics, form, and lifting execution.")) {
        state.sessionData.dashboard_offers.fitness = 'Exercise Mechanics Library';
      } else {
        state.sessionData.dashboard_offers.fitness = 'Accountability & Consistency Engine';
      }
    }
  },

  // 2. DIET & NUTRITION BALANCE (Conditional)
  diet_q1: {
    type: 'single',
    title: "How would you describe your current eating habits?",
    subtitle: "",
    options: [
      { id: 'diet_q1_convenient', text: "I eat whatever is convenient (takeout/fast food).", desc: "High reliance on external meals, takeout, or processed options.", icon: 'coffee' },
      { id: 'diet_q1_no_struct', text: "I try to eat clean but have absolutely no structure.", desc: "Healthy intentions but inconsistent meal times or selections.", icon: 'compass' },
      { id: 'diet_q1_skip_meals', text: "I skip meals often and have low daily energy.", desc: "Irregular fuel supply causing metabolic drops and brain fog.", icon: 'battery-low' },
      { id: 'diet_q1_optimize', text: "I track meals but want to optimize macros.", desc: "Already tracking nutrition but looking to maximize biological leverage.", icon: 'trending-up' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.diet_q1 = val;
    }
  },

  diet_q2: {
    type: 'single',
    title: "What is the biggest obstacle stopping you from eating clean?",
    subtitle: "",
    options: [
      { id: 'diet_q2_time', text: "Lack of time for meal prep, grocery shopping, and cooking.", desc: "PREP RESISTANCE. Busy schedules conflict with standard home cooking.", icon: 'clock' },
      { id: 'diet_q2_friction', text: "The tedious friction of counting calories/macros.", desc: "LOGGING FRICTION. You start counting but give up because tracking is tedious.", icon: 'alert-triangle' },
      { id: 'diet_q2_social', text: "Social eating, cravings, and weekend cheat cycles.", desc: "Peer group eating pressures and late-night cravings.", icon: 'users' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.diet_q2 = val;
    }
  },

  diet_q3: {
    type: 'multiple',
    title: "Nutrition is half the battle. How do you want us to handle your fuel?",
    subtitle: "",
    options: [
      { id: 'diet_q3_quick_log', text: "Give me a fast, frictionless tool to log food without counting stress.", desc: "AI single-sentence log, avoiding tedious manual typing.", icon: 'zap' },
      { id: 'diet_q3_blueprint', text: "Lock in a rock-solid, easy macro blueprint customized for my body.", desc: "Easy macro blueprints custom-built for your body type.", icon: 'shield' },
      { id: 'diet_q3_prep', text: "Provide a streamlined 15-minute high-protein meal prep strategy.", desc: "Fast macro-meal builders for high-performance scheduling.", icon: 'flame' }
    ],
    save: (vals) => {
      state.sessionData.flow_responses.diet_q3 = vals;
      state.sessionData.dashboard_offers = state.sessionData.dashboard_offers || {};
      if (vals.includes("Give me a fast, frictionless tool to log food without counting stress.")) {
        state.sessionData.dashboard_offers.nutrition = 'AI Single-Sentence Quick-Log Widget';
      } else if (vals.includes("Lock in a rock-solid, easy macro blueprint customized for my body.")) {
        state.sessionData.dashboard_offers.nutrition = '15-Minute Macro-Meal Builder Blueprint';
      } else {
        state.sessionData.dashboard_offers.nutrition = 'Weekly Caloric Buffer & Reset Engine';
      }
    }
  },

  // 3. SLEEP & CIRCADIAN RHYTHM (Conditional)
  sleep_q1: {
    type: 'single',
    title: "What does your current sleep schedule look like?",
    subtitle: "",
    options: [
      { id: 'sleep_q1_chaotic', text: "Completely chaotic — sleep times change daily.", desc: "Fluctuating sleep-wake boundaries causing heavy fatigue cycles.", icon: 'shuffle' },
      { id: 'sleep_q1_fixed_tired', text: "Somewhat fixed, but I feel tired all day.", desc: "Fixed schedule but poor quality, leaving you depleted.", icon: 'battery-low' },
      { id: 'sleep_q1_waking', text: "I sleep enough hours but wake up multiple times at night.", desc: "Fragmented sleep blocks preventing deep REM cycle recovery.", icon: 'moon' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.sleep_q1 = val;
    }
  },

  sleep_q2: {
    type: 'single',
    title: "Where does your nighttime routine break down the most?",
    subtitle: "",
    options: [
      { id: 'sleep_q2_scrolling', text: "Revenge bedtime procrastination (phone scrolling).", desc: "Late-night neural stimulation blocking melatonin release.", icon: 'smartphone' },
      { id: 'sleep_q2_late_study', text: "Late-night studying, working, or overthinking.", desc: "High cognitive stimulation and stress hormone spikes near bed hours.", icon: 'brain' },
      { id: 'sleep_q2_caffeine', text: "Relying on caffeine too late in the afternoon.", desc: "Adenosine receptors blocked, lowering deep sleep duration.", icon: 'coffee' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.sleep_q2 = val;
    }
  },

  sleep_q3: {
    type: 'multiple',
    title: "Let's fix your energy levels. What is the ultimate goal for your sleep?",
    subtitle: "",
    options: [
      { id: 'sleep_q3_reset', text: "Resetting my biological clock so I wake up energized without an alarm.", desc: "Waking up in optimal REM windows with somatic checklists.", icon: 'sun' },
      { id: 'sleep_q3_winddown', text: "Building an unbreakable, screen-free wind-down routine at night.", desc: "Digital sunset screen-lock protocols and wind-down tools.", icon: 'lock' },
      { id: 'sleep_q3_env', text: "Optimizing my bedroom environment and deep sleep quality flags.", desc: "Blackout, temperature, and environment baseline calibrations.", icon: 'home' }
    ],
    save: (vals) => {
      state.sessionData.flow_responses.sleep_q3 = vals;
      state.sessionData.dashboard_offers = state.sessionData.dashboard_offers || {};
      if (vals.includes("Resetting my biological clock so I wake up energized without an alarm.")) {
        state.sessionData.dashboard_offers.sleep = 'Immediate Action Morning Light & Somatic Checklist';
      } else if (vals.includes("Building an unbreakable, screen-free wind-down routine at night.")) {
        state.sessionData.dashboard_offers.sleep = 'Digital Sunset Screen-Lock Protocol';
      } else {
        state.sessionData.dashboard_offers.sleep = 'Optimized Circadian REM Window Calculator';
      }
    }
  },

  // 4. FOCUS, DISCIPLINE & STUDY (Conditional)
  study_q1: {
    type: 'single',
    title: "How many hours of focused study do you hit daily?",
    subtitle: "",
    options: [
      { id: 'study_q1_less_2', text: "Less than 2 hours — I struggle to lock in.", desc: "Heavy friction starting study sessions, low daily focus volume.", icon: 'clock' },
      { id: 'study_q1_2_5', text: "2 to 5 hours — I work with constant interruptions.", desc: "Decent duration but fragmented by regular context switches.", icon: 'smartphone' },
      { id: 'study_q1_more_5', text: "5+ hours — I study heavily but feel highly inefficient.", desc: "High hours, but suffering from diminishing returns and fatigue.", icon: 'battery-low' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.study_q1 = val;
    }
  },

  study_q2: {
    type: 'single',
    title: "What completely destroys your focus during a session?",
    subtitle: "",
    options: [
      { id: 'study_q2_friction', text: "Task activation friction (procrastinating on starting tough topics).", desc: "Avoiding complex tasks until the absolute final hour.", icon: 'alert-circle' },
      { id: 'study_q2_switching', text: "Context switching (checking phone tabs, notifications, or social media).", desc: "Checking notifications or other browser tabs every 10 minutes.", icon: 'smartphone' },
      { id: 'study_q2_fatigue', text: "Mental fog and physical fatigue setting in after 30 minutes.", desc: "Rapid stamina drops depleting starting motivation.", icon: 'battery-low' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.study_q2 = val;
    }
  },

  study_q3: {
    type: 'multiple',
    title: "To crush your studies and deep work sessions, what do you need in your corner?",
    subtitle: "",
    options: [
      { id: 'study_q3_vault', text: "A high-focus digital vault to lock down my sessions and block out tabs.", desc: "Focus vaults and browser shield structures.", icon: 'lock' },
      { id: 'study_q3_pacing', text: "A sustainable pacing system so I study hard without burning out.", desc: "Study-to-rest optimal ratio protocols.", icon: 'activity' },
      { id: 'study_q3_prior', text: "An automated task-prioritization framework to clear brain fog.", desc: "3-item priority matrix filters to clear study overload.", icon: 'copy' }
    ],
    save: (vals) => {
      state.sessionData.flow_responses.study_q3 = vals;
      state.sessionData.dashboard_offers = state.sessionData.dashboard_offers || {};
      if (vals.includes("A high-focus digital vault to lock down my sessions and block out tabs.")) {
        state.sessionData.dashboard_offers.focus = 'AI Time-Block Focus Vault';
      } else if (vals.includes("A sustainable pacing system so I study hard without burning out.")) {
        state.sessionData.dashboard_offers.focus = 'Sustainable Study-to-Rest Pacing Protocol';
      } else {
        state.sessionData.dashboard_offers.focus = '5-Minute Mindset Activation Timer';
      }
    }
  },

  // 5. MENTAL HEALTH & INNER PEACE (Conditional)
  mental_q1: {
    type: 'single',
    title: "How often does daily stress paralyze your routine?",
    subtitle: "",
    options: [
      { id: 'mental_q1_constant', text: "Constantly — overthinking stops me from acting.", desc: "Analysis paralysis keeping your actions locked in overthinking.", icon: 'brain' },
      { id: 'mental_q1_occasional', text: "Occasionally — I execute but feel mentally drained.", desc: "Getting things done but carrying heavy cognitive stress daily.", icon: 'battery-low' },
      { id: 'mental_q1_turnoff', text: "Rarely, but I struggle to turn off my brain at the end of the day.", desc: "Worry cycles and neural noise humming during wind-down periods.", icon: 'shuffle' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.mental_q1 = val;
    }
  },

  mental_q2: {
    type: 'single',
    title: "What triggers your mental fatigue the most?",
    subtitle: "",
    options: [
      { id: 'mental_q2_changes', text: "Unexpected changes or friction in my daily plans.", desc: "Frustration and anxiety spikes when external events disrupt schedules.", icon: 'alert-triangle' },
      { id: 'mental_q2_chaotic', text: "A chaotic, unorganized physical and digital space.", desc: "Sensory clutter in your workspace or device draining your drive.", icon: 'shuffle' },
      { id: 'mental_q2_compare', text: "Comparing my progress to others and feeling behind.", desc: "Self-criticism and imposter loops slowing down task momentum.", icon: 'frown' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.mental_q2 = val;
    }
  },

  mental_q3: {
    type: 'multiple',
    title: "When overthinking hits or things get chaotic, how are we clearing your mind?",
    subtitle: "",
    options: [
      { id: 'mental_q3_breathwork', text: "Give me quick, 5-minute breathwork protocols to drop my stress instantly.", desc: "Physiological sigh and nervous system down-regulation (NSDR).", icon: 'wind' },
      { id: 'mental_q3_brain_dump', text: "Give me a rapid mental clarity tool to dump my thoughts and stay sharp.", desc: "Brain-dump clarity blueprint filters to extract priority actions.", icon: 'copy' },
      { id: 'mental_q3_perspective', text: "Build a daily perspective framework to handle performance anxiety.", desc: "Daily Stoic resilience reflection grounding matrices.", icon: 'shield' }
    ],
    save: (vals) => {
      state.sessionData.flow_responses.mental_q3 = vals;
      state.sessionData.dashboard_offers = state.sessionData.dashboard_offers || {};
      if (vals.includes("Give me quick, 5-minute breathwork protocols to drop my stress instantly.")) {
        state.sessionData.dashboard_offers.mental = 'Nervous System Down-Regulation (NSDR) Recovery Hub';
      } else if (vals.includes("Give me a rapid mental clarity tool to dump my thoughts and stay sharp.")) {
        state.sessionData.dashboard_offers.mental = 'Brain-Dump Clarity Blueprint (3-Item Action List)';
      } else {
        state.sessionData.dashboard_offers.mental = 'Daily Stoic Resilience Reflection Grounding Box';
      }
    }
  },

  // 6. RELATIONSHIPS & SOCIAL LIFE (Conditional)
  relationships_q1: {
    type: 'multiple',
    title: "Where do you currently invest or spend most of your time socially?",
    subtitle: "Select all options that apply.",
    get options() {
      const gender = state.sessionData?.basic_info?.gender || (typeof userState !== 'undefined' && userState?.genderIdentity) || '';
      let romanticPartnerText = "With my Partner";
      if (gender === 'Male') {
        romanticPartnerText = "With my Girlfriend";
      } else if (gender === 'Female') {
        romanticPartnerText = "With my Boyfriend";
      }

      return [
        { id: 'rel_q1_alone', text: "Mostly Alone", desc: "Focusing heavily on self-reliance or feeling disconnected.", icon: 'user' },
        { id: 'rel_q1_family', text: "With Family", desc: "Spending significant time with parents, siblings, or relatives.", icon: 'home' },
        { id: 'rel_q1_friends', text: "With Friends / Peers", desc: "Spending time with friend circles, study peers, or coworkers.", icon: 'users' },
        { id: 'rel_q1_romantic', text: romanticPartnerText, desc: "Spending quality time investing in your primary romantic partnership.", icon: 'heart' }
      ];
    },
    save: (vals) => {
      state.sessionData.flow_responses.relationships_q1 = vals;
      buildDynamicQueue();
    }
  },

  relationships_q2_active: {
    type: 'single',
    get title() {
      const gender = state.sessionData?.basic_info?.gender || (typeof userState !== 'undefined' && userState?.genderIdentity) || '';
      let partnerLabel = "Partner";
      if (gender === 'Male') partnerLabel = "Girlfriend";
      else if (gender === 'Female') partnerLabel = "Boyfriend";
      return `How would you honestly describe the current state of your relationship with your ${partnerLabel}?`;
    },
    subtitle: "",
    options: [
      { id: 'rel_q2_elite', text: "Elite Sync", desc: "Mutual support, deep values alignment, and shared micro-routines.", icon: 'zap' },
      { id: 'rel_q2_passive', text: "Passive Distance", desc: "Comfortable but drifting, lacking deep communication focus.", icon: 'compass' },
      { id: 'rel_q2_volatility', text: "Constant Volatility", desc: "Frequent misunderstandings and energy drainage. (Score deduction: -20 MIND)", icon: 'battery-low' },
      { id: 'rel_q2_toxic', text: "Toxic Trap", desc: "Heavy emotional drama depleting study/work grit. (Score deduction: -25 PURPOSE)", icon: 'alert-triangle' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.relationships_q2 = val;
    }
  },


  relationships_q2_history: {
    type: 'single',
    title: "Have you been in a romantic relationship recently?",
    subtitle: "",
    options: [
      { id: 'rel_q2_h_recent', text: "Yes, currently or recently (< 1 month)", desc: "Fresh separation or loosely looking for new alignment.", icon: 'refresh-cw' },
      { id: 'rel_q2_h_medium', text: "Yes (Between 1 to 6 months ago)", desc: "Processing lessons, focusing on routine stabilization.", icon: 'calendar' },
      { id: 'rel_q2_h_year', text: "Yes (Between 6 months to 1 year ago)", desc: "Recovering autonomy, building high-performance lifestyle.", icon: 'lock' },
      { id: 'rel_q2_h_long', text: "Yes (Long term, > 1 year ago)", desc: "Substantial single block, established individual habits.", icon: 'shield' },
      { id: 'rel_q2_h_never', text: "No, I’ve been single for a long time / never in one", desc: "Focusing purely on self-sovereignty and absolute focus goals.", icon: 'compass' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.relationships_q2 = val;
    }
  },

  relationships_q3: {
    type: 'single',
    title: "Let's audit the rest of your core social structure. Which of these bottlenecks hits closest to home right now?",
    subtitle: "",
    get options() {
      const q1Ans = state.sessionData.flow_responses?.relationships_q1 || [];
      const opts = [];

      if (q1Ans.includes("Mostly Alone")) {
        opts.push({ id: 'rel_q3_isolation', text: "Isolation Sink", desc: "I have zero social outlets and feel completely cut off.", icon: 'user-x' });
      }
      if (q1Ans.includes("With Family")) {
        opts.push({ id: 'rel_q3_family', text: "Family Friction", desc: "High family expectations or domestic drama are breaking my focus.", icon: 'home' });
      }
      if (q1Ans.includes("With Friends / Peers")) {
        opts.push({ id: 'rel_q3_peers', text: "Low-Vibe Circle", desc: "My current friends are complacent; they just want to kill time.", icon: 'users' });
      }
      
      // Render permanent baseline fallback option
      opts.push({ id: 'rel_q3_none', text: "Zero Friction", desc: "My remaining social circles are stable; I just need to execute.", icon: 'shield-check' });

      return opts;
    },
    save: (val) => {
      state.sessionData.flow_responses.relationships_q3 = val;
      state.sessionData.dashboard_offers = state.sessionData.dashboard_offers || {};
      if (val === "Isolation Sink") {
        state.sessionData.dashboard_offers.social = 'Social Connection & Vibe Alignment Protocol';
      } else if (val === "Family Friction") {
        state.sessionData.dashboard_offers.social = 'Stoic Boundaries & Compassion Rings Map';
      } else if (val === "Low-Vibe Circle") {
        state.sessionData.dashboard_offers.social = 'Attention Insulation & Peer Upgrades Vault';
      } else {
        state.sessionData.dashboard_offers.social = 'Inner Circle Automation Reminders';
      }
    }
  },

  relationships_q4: {
    type: 'single',
    title: "What is your biggest psychological bottleneck when dealing with people?",
    subtitle: "",
    options: [
      { id: 'rel_q4_anxiety', text: "Social Anxiety / Overthinking", desc: "Fear of judgment or over-analyzing social interactions.", icon: 'alert-circle' },
      { id: 'rel_q4_pleasing', text: "People Pleasing / Weak Boundaries", desc: "Sacrificing personal priorities to appease others.", icon: 'shield-alert' },
      { id: 'rel_q4_validation', text: "Validation Seeking / Status Addiction", desc: "Chasing external approval or social comparison circles.", icon: 'award' },
      { id: 'rel_q4_unavailability', text: "Emotional Unavailability / Hyper-Independence", desc: "Struggling to let people in or build deep emotional bridges.", icon: 'lock' },
      { id: 'rel_q4_none', text: "Zero Friction / Fully Calibrated", desc: "Confident, stable, and highly functional interpersonal states.", icon: 'shield-check' }
    ],
    save: (val) => {
      state.sessionData.flow_responses.relationships_q4 = val;
    }
  },

  // 11. ROUTINE STRUCTURE PAGE (Universal)
  routine: {
    type: 'single',
    title: 'How predictable are your days?',
    subtitle: '',
    options: [
      { id: 'rout_extremely', text: 'Extremely structured', desc: 'Time-blocked hours, exact wake/sleep schedules.', icon: 'calendar' },
      { id: 'rout_somewhat', text: 'Somewhat organized', desc: 'Loose morning routines, basic calendar checkmarks.', icon: 'check-square' },
      { id: 'rout_different', text: 'Different every day', desc: 'Fluctuating schedules, adapting to external requirements.', icon: 'shuffle' },
      { id: 'rout_chaotic', text: 'Completely chaotic', desc: 'No plan, reacting blindly to whatever occurs hourly.', icon: 'alert-triangle' },
      { id: 'rout_almost_no', text: 'I have almost no routine', desc: 'Aimless transitions, massive sleep drifting, highly reactive.', icon: 'compass' }
    ],
    save: (val) => { state.sessionData.general_responses.routine = val; }
  },
  

  reflection_pride: {
    type: 'single',
    title: 'When was the last time you truly felt proud of yourself?',
    subtitle: '',
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
    subtitle: '',
    options: [
      { id: 'id_rebuild_life', text: 'I’m trying to rebuild my life slowly', desc: 'Healing systems, establishing gentle baseline routines.', icon: 'activity' },
      { id: 'id_disciplined', text: 'I want to become disciplined and consistent', desc: 'Systemizing habits, killing doomscrolling and distractions.', icon: 'lock' },
      { id: 'id_full_potential', text: 'I want to unlock my full potential', desc: 'High-end optimization across physical, focus, and lifestyle.', icon: 'zap' },
      { id: 'id_peace_balance', text: 'I want peace and balance', desc: 'Stoic resilience, mental calm, deep circadian rest.', icon: 'wind' },
      { id: 'id_transform', text: 'I want to transform myself completely', desc: 'Reinventing character, body, mind, and professional drive.', icon: 'sparkles' },
      { id: 'id_high_perf', text: 'I want a high-performance lifestyle', desc: 'Maximum leverage outputs, biological metrics, and grit.', icon: 'award' }
    ],
    save: (val) => {
      state.sessionData.general_responses.identity = val;
      calculateLifeMapMetrics();
    }
  },
  
  // NEW PAGE — VALUES & PRIORITIES
  values_priorities: {
    type: 'multiple',
    title: 'What matters most to you right now?',
    subtitle: '',
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



  // NEW PAGE — ROUTINE CONFIDENCE SCALE
  routine_confidence: {
    type: 'custom',
    render: renderRoutineConfidence
  },

  // NEW PAGE — ADDICTIONS & DISTRACTIONS
  addictions_distractions: {
    type: 'multiple',
    title: 'Are there any habits or addictions currently holding you back?',
    subtitle: '',
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
    subtitle: '',
    options: [
      { id: 'int_gentle', text: 'Gentle & Supportive', desc: '“I want slow, sustainable progress without pressure.”', icon: 'heart' },
      { id: 'int_balanced', text: 'Balanced Growth', desc: '“Push me enough to grow while keeping things manageable.”', icon: 'trending-up' },
      { id: 'int_serious', text: 'Serious Transformation', desc: '“I want strong accountability and real discipline.”', icon: 'shield' },
      { id: 'int_elite', text: 'Elite Challenge Mode', desc: '“Push me hard. I want maximum growth and intensity.”', icon: 'zap' }
    ],
    save: (val) => { state.sessionData.general_responses.challenge_intensity = val; }
  },



  // NEW PAGE — FUTURE SELF VISION
  future_self_vision: {
    type: 'multiple',
    title: 'If everything improved in the next year, what would change the most?',
    subtitle: '',
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

  // NEW PAGE — PROFILE & LIFE MAP
  profile_life_map: {
    type: 'custom',
    render: renderProfileLifeMap
  },
  
  // NEW PAGE — WHAT'S HOLDING YOU BACK
  whats_holding_you_back: {
    type: 'custom',
    render: renderWhatsHoldingYouBack
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
  
  // Base initial queue (life_state removed)
  state.activeQueue = ['welcome', 'basic_info', 'focus_areas'];
  
  // Sync the navigation header state (hidden initially)
  const header = document.getElementById('app-header');
  if (header) header.classList.remove('visible');
  
  updateDBInspectorBadge();
}

function buildDynamicQueue() {
  const chosen = state.sessionData.focus_areas || [];
  const dynamicNodes = [];

  // 1. Gym & Fitness Training
  if (chosen.includes('Gym & Fitness Training')) {
    const gymQ1Ans = state.sessionData.flow_responses?.gym_q1;
    const gymQ2PushbackAns = state.sessionData.flow_responses?.gym_q2_pushback;
    
    if (gymQ1Ans === 'I am currently completely inactive.') {
      dynamicNodes.push('gym_q1', 'gym_q2_pushback');
      
      if (gymQ2PushbackAns === 'No.') {
        dynamicNodes.push('gym_mogging');
      } else if (gymQ2PushbackAns === 'Yes.' || gymQ2PushbackAns === "I don't want to do it, but I could if it actually improves my health or fitness.") {
        dynamicNodes.push('gym_q3_adaptation', 'gym_q3');
      }
    } else {
      dynamicNodes.push('gym_q1', 'gym_q2', 'gym_q3');
    }
  }

  // 2. Diet & Nutrition Balance
  if (chosen.includes('Diet & Nutrition Balance')) {
    dynamicNodes.push('diet_q1', 'diet_q2', 'diet_q3');
  }

  // 3. Sleep & Circadian Rhythm
  if (chosen.includes('Sleep & Circadian Rhythm')) {
    dynamicNodes.push('sleep_q1', 'sleep_q2', 'sleep_q3');
  }

  // 4. Focus, Discipline & Study
  if (chosen.includes('Focus, Discipline & Study')) {
    dynamicNodes.push('study_q1', 'study_q2', 'study_q3');
  }

  // 5. Mental Health & Inner Peace
  if (chosen.includes('Mental Health & Inner Peace')) {
    dynamicNodes.push('mental_q1', 'mental_q2', 'mental_q3');
  }

  // 6. Relationships & Social Life
  if (chosen.includes('Relationships & Social Life')) {
    dynamicNodes.push('relationships_q1');
    const q1Ans = state.sessionData.flow_responses?.relationships_q1 || [];
    const hasRomantic = q1Ans.includes("With my Girlfriend") || q1Ans.includes("With my Boyfriend") || q1Ans.includes("With my Partner");
    
    if (hasRomantic) {
      dynamicNodes.push('relationships_q2_active');
    } else {
      dynamicNodes.push('relationships_q2_history');
    }
    dynamicNodes.push('relationships_q3', 'relationships_q4');
  }

  const universalEndNodes = [
    'routine',
    'identity',
    'routine_confidence',
    'addictions_distractions',
    'challenge_intensity',
    'profile_life_map',
    'ai_analysis_loading',
    'how_we_see_you',
    'whats_holding_you_back',
    'final_roadmap'
  ];

  state.activeQueue = [
    'welcome',
    'basic_info',
    'focus_areas',
    ...dynamicNodes,
    ...universalEndNodes
  ];
}

// Legacy stub — kept for safety; sleep_support is now always in the queue
function injectSleepSupportNode() { /* no-op: sleep_support is always queued */ }

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
    if (nodeKey === 'welcome' || nodeKey === 'final_roadmap' || nodeKey === 'gym_mogging') {
      header.classList.remove('visible');
    } else {
      header.classList.add('visible');
      updateProgressBar();
    }
  }

  // 2. Build the incoming page element (but don't attach yet)
  const viewWrap = document.createElement('div');
  viewWrap.className = 'page-view';

  if (state.activeNode?.type === 'custom') {
    state.activeNode?.render?.(viewWrap);
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
  const wrapper = document.querySelector('.progress-bar-wrapper');
  
  const nodeKey = state.activeQueue[state.currentStepIndex];
  const postQuestionnaireNodes = [
    'profile_life_map',
    'ai_analysis_loading',
    'how_we_see_you',
    'whats_holding_you_back',
    'what_most_never_realize',
    'transformation_preview',
    'final_roadmap'
  ];

  if (postQuestionnaireNodes.includes(nodeKey)) {
    if (wrapper) {
      wrapper.style.opacity = '0';
      wrapper.style.pointerEvents = 'none';
    }
    return;
  } else {
    if (wrapper) {
      wrapper.style.opacity = '1';
      wrapper.style.pointerEvents = 'auto';
    }
  }
  
  // We exclude welcome, final_roadmap, and post-questionnaire nodes from active step counts
  const totalQuestions = state.activeQueue.filter(key => key !== 'welcome' && key !== 'final_roadmap' && !postQuestionnaireNodes.includes(key)).length;
  const currentQuestionIdx = state.activeQueue.indexOf(state.activeQueue[state.currentStepIndex]); // index offset
  
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
  const isMultiple = state.activeNode?.type === 'multiple';
  
  // Retrieve previously selected value if navigating backward
  const nodeKey = state.activeQueue?.[state.currentStepIndex];
  let selectedVal = null;
  if (isMultiple) {
    // Check flow_responses first, then top-level sessionData (covers life_state & focus_areas),
    // then focus_areas array, then default to empty array.
    const topLevel = state.sessionData?.[nodeKey];
    selectedVal = state.sessionData?.flow_responses?.[nodeKey]
               || state.sessionData?.general_responses?.[nodeKey]
               || (Array.isArray(topLevel) ? topLevel : null)
               || [];
  } else {
    selectedVal = state.sessionData?.flow_responses?.[nodeKey] ||
                  state.sessionData?.general_responses?.[nodeKey] || '';
  }
  
  const title = state.activeNode?.title || '';
  const subtitle = state.activeNode?.subtitle || '';
  
  viewWrap.innerHTML = `
    <div class="question-header">
      <span class="question-pre">Kairos Analysis</span>
      <h2 class="question-title">${title}</h2>
      <p class="question-desc">${subtitle}</p>
    </div>
    
    <div class="${isMultiple ? 'cards-grid' : 'cards-layout'}">
      ${(state.activeNode?.options || []).map(opt => {
        const isSel = isMultiple ? (Array.isArray(selectedVal) ? selectedVal.includes(opt.text) : false) : selectedVal === opt.text;
        
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
        const NONE_VAL = 'None of these';

        if (val === NONE_VAL) {
          // Toggle "None of these" — if already selected, deselect it
          if (chosenArray.includes(NONE_VAL)) {
            chosenArray = [];
            card.classList.remove('selected');
          } else {
            // Select only "None of these", clear everything else
            chosenArray = [NONE_VAL];
            cards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
          }
        } else {
          // Regular item — always deselect "None of these" first
          chosenArray = chosenArray.filter(v => v !== NONE_VAL);
          const noneCard = Array.from(cards).find(c => c.getAttribute('data-value') === NONE_VAL);
          if (noneCard) noneCard.classList.remove('selected');

          // Toggle this item
          if (chosenArray.includes(val)) {
            chosenArray = chosenArray.filter(v => v !== val);
            card.classList.remove('selected');
          } else {
            if (nodeKey === 'focus_areas' && chosenArray.length >= 4) {
              showNotification("You can select up to 4 focus areas maximum.");
              return;
            }
            chosenArray.push(val);
            card.classList.add('selected');
          }
        }

        continueBtn.toggleAttribute('disabled', chosenArray.length === 0);
      });
    });
    
    continueBtn.addEventListener('click', () => {
      // Save and advance
      state.activeNode.save(chosenArray);
      advanceStep();
    });
    
  } else {
    // Single Selection Flow: Snappy card select with dynamic click lock to prevent skipping
    let cardClicked = false;
    cards.forEach(card => {
      card.addEventListener('click', () => {
        if (cardClicked) return;
        cardClicked = true;

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
    </form>
    
    <div class="action-bar" style="margin-top: 24px;">
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
  
  // Form submission validations
  viewWrap.querySelector('#btn-submit-info').addEventListener('click', () => {
    const nameInp = viewWrap.querySelector('#inp-first-name');
    const ageInp = viewWrap.querySelector('#inp-age');
    const countrySel = viewWrap.querySelector('#sel-country');
    const occupSel = viewWrap.querySelector('#sel-occupation');
    
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
    
    // Compile and advance
    info.first_name = nameInp.value.trim();
    info.age = parseInt(ageInp.value);
    info.country = countrySel.value;
    info.occupation = occupSel.value;
    
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
  return info.first_name && info.age && info.gender && info.country && info.occupation;
}

// SCREEN: Interactive 1-10 Routine Confidence Slider Scale
// Dynamically repaints the slider filled-track and thumb glow based on zone
function updateSliderTrack(sliderEl) {
  const val = parseInt(sliderEl.value);
  const pct = ((val - 1) / 9) * 100; // 1-10 mapped to 0-100%

  let fillColor, glowColor, thumbGlow;
  if (val <= 3) {
    // Low zone — warm red/amber
    fillColor = `linear-gradient(to right, #ef4444 0%, #f97316 ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;
    glowColor = 'rgba(239, 68, 68, 0.55)';
    thumbGlow = '0 0 18px rgba(239, 68, 68, 0.9), 0 0 6px rgba(249, 115, 22, 0.6)';
  } else if (val <= 7) {
    // Mid zone — brand blue/purple
    fillColor = `linear-gradient(to right, #6366f1 0%, #8b5cf6 ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;
    glowColor = 'rgba(99, 102, 241, 0.55)';
    thumbGlow = '0 0 18px rgba(99, 102, 241, 0.9), 0 0 6px rgba(139, 92, 246, 0.6)';
  } else {
    // High zone — neon violet/purple
    fillColor = `linear-gradient(to right, #7c3aed 0%, #a855f7 ${pct}%, #e879f9 ${pct * 0.98}%, rgba(255,255,255,0.08) ${pct}%)`;
    glowColor = 'rgba(168, 85, 247, 0.7)';
    thumbGlow = '0 0 22px rgba(168, 85, 247, 1), 0 0 8px rgba(232, 121, 249, 0.8)';
  }

  sliderEl.style.background = fillColor;
  // Apply thumb glow via CSS variable read by the pseudo-element shimmer
  sliderEl.style.setProperty('--thumb-glow', thumbGlow);
  // Update the track box-shadow to cast ambient glow
  sliderEl.style.boxShadow = `0 2px 12px -2px ${glowColor}`;
}

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
  updateSliderTrack(slider);

  slider.addEventListener('input', (e) => {
    updateFeedback(parseInt(e.target.value));
    updateSliderTrack(e.target);
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
  if (addictions.includes('Late-night scrolling') || state.sessionData.flow_responses.sleep_state?.includes('Pretty bad')) {
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

  // Optimized pulse animation loop for sub-2-second resolution
  const interval = setInterval(() => {
    currentPercent += Math.floor(Math.random() * 10) + 7;
    if (currentPercent >= 100) {
      currentPercent = 100;
      clearInterval(interval);
      pct.innerText = `100%`;
      status.innerText = "Growth profile synthesized.";
      setTimeout(() => {
        advanceStep();
      }, 500);
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
        }, 150);
      }
    }
  }, 110);
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

// --- DYNAMIC SCORES CALCULATION FOR LIFE MAP ---
function calculateLifeMapMetrics() {
  const flow = state.sessionData.flow_responses || {};
  const focus = state.sessionData.focus_areas || [];
  const addictions = state.sessionData.general_responses?.addictions_distractions || [];

  // 1. BODY (Gym & Fitness Training)
  let body = 85;
  if (focus.includes('Gym & Fitness Training')) {
    body = 100;
    const gymQ1 = flow.gym_q1 || '';
    if (gymQ1 === 'I am currently completely inactive.') {
      body -= 40;
    } else if (gymQ1 === 'I do home workouts / bodyweight routines.') {
      body -= 15;
    }
  }

  // 2. FUEL (Diet & Nutrition Balance)
  let fuel = 85;
  if (focus.includes('Diet & Nutrition Balance')) {
    fuel = 100;
    const dietQ1 = flow.diet_q1 || '';
    if (dietQ1 === 'I eat whatever is convenient (takeout/fast food).') {
      fuel -= 35;
    } else if (dietQ1 === 'I try to eat clean but have absolutely no structure.') {
      fuel -= 15;
    } else if (dietQ1 === 'I skip meals often and have low daily energy.') {
      fuel -= 20;
    }
  }

  // 3. REST (Sleep & Circadian Rhythm)
  let rest = 85;
  if (focus.includes('Sleep & Circadian Rhythm')) {
    rest = 100;
    const sleepQ1 = flow.sleep_q1 || '';
    if (sleepQ1 === 'Completely chaotic — sleep times change daily.') {
      rest -= 40;
    } else if (sleepQ1 === 'Somewhat fixed, but I feel tired all day.') {
      rest -= 15;
    } else if (sleepQ1 === 'I sleep enough hours but wake up multiple times at night.') {
      rest -= 20;
    }
  }
  
  // Deduct 25 points if consistency target is 7 or more days (severe overtraining)
  if (flow.gym_q2 === "7 or more days a week.") {
    rest -= 25;
  }

  // Deduct 20 points if routine is chaotic or almost none
  const routine = state.sessionData.general_responses?.routine || '';
  if (routine === "Completely chaotic" || routine === "I have almost no routine") {
    rest -= 20;
  }

  // 4. MIND (Focus, Discipline & Study)
  let mind = 85;
  if (focus.includes('Focus, Discipline & Study')) {
    mind = 100;
    const studyQ1 = flow.study_q1 || '';
    if (studyQ1 === 'Less than 2 hours — I struggle to lock in.') {
      mind -= 35;
    } else if (studyQ1 === '2 to 5 hours — I work with constant interruptions.') {
      mind -= 15;
    } else if (studyQ1 === '5+ hours — I study heavily but feel highly inefficient.') {
      mind -= 10;
    }
  }

  // 5. PURPOSE (Mental Health & Inner Peace)
  let purpose = 85;
  if (focus.includes('Mental Health & Inner Peace')) {
    purpose = 100;
    const mentalQ1 = flow.mental_q1 || '';
    if (mentalQ1 === 'Constantly — overthinking stops me from acting.') {
      purpose -= 40;
    } else if (mentalQ1 === 'Occasionally — I execute but feel mentally drained.') {
      purpose -= 20;
    } else if (mentalQ1 === 'Rarely, but I struggle to turn off my brain at the end of the day.') {
      purpose -= 10;
    }
  }

  // 6. CONNECTION (Relationships & Social Life)
  let connection = 85;
  if (focus.includes('Relationships & Social Life')) {
    connection = 100;
    
    // Q1 Checkbox Multiselect
    const relQ1 = flow.relationships_q1 || [];
    if (Array.isArray(relQ1)) {
      if (relQ1.includes("Mostly Alone")) {
        connection -= 30;
      }
    } else if (typeof relQ1 === 'string' && relQ1.includes("Mostly Alone")) {
      connection -= 30;
    }
    
    // Q2 Branch routing answers
    const relQ2 = flow.relationships_q2 || '';
    if (relQ2 === 'Constant Volatility') {
      mind -= 20;
    } else if (relQ2 === 'Toxic Trap') {
      purpose -= 25;
    }
    
    // Q3 Bottlenecks
    const relQ3 = flow.relationships_q3 || '';
    if (relQ3 === 'Isolation Sink') {
      connection -= 25;
    } else if (relQ3 === 'Family Friction') {
      connection -= 15;
    } else if (relQ3 === 'Low-Vibe Circle') {
      connection -= 20;
    }

    // Q4 Psychological Bottlenecks
    const relQ4 = flow.relationships_q4 || '';
    if (relQ4 === 'Social Anxiety / Overthinking') {
      mind -= 15;
    } else if (relQ4 === 'People Pleasing / Weak Boundaries') {
      purpose -= 15;
    } else if (relQ4 === 'Validation Seeking / Status Addiction') {
      fuel -= 10;
    } else if (relQ4 === 'Emotional Unavailability / Hyper-Independence') {
      connection -= 10;
    } else if (relQ4 === 'Zero Friction / Fully Calibrated') {
      mind += 5;
    }
  }

  // --- ADDICTIONS / HABITS DYNAMIC DEDUCTIONS ENGINE ---
  // 1. Smoking / Vaping: -30 from BODY
  if (addictions.includes('Smoking')) {
    body -= 30;
  }
  
  // 2. Alcohol: -12.5 from BODY and -12.5 from REST
  if (addictions.includes('Alcohol')) {
    body -= 12.5;
    rest -= 12.5;
  }
  
  // 3. Social Media / Phone Addiction: -20 from MIND
  if (addictions.includes('Social media addiction') || addictions.includes('Phone addiction')) {
    mind -= 20;
  }
  
  // 4. Late-Night Scrolling: -25 from REST
  if (addictions.includes('Late-night scrolling')) {
    rest -= 25;
  }
  
  // 5. Overeating: -20 from FUEL
  if (addictions.includes('Overeating')) {
    fuel -= 20;
  }
  
  // 6. Constant Procrastination: -30 from PURPOSE
  if (addictions.includes('Constant procrastination')) {
    purpose -= 30;
  }
  
  if (addictions.includes('Overthinking') || addictions.includes('Negative self-talk')) {
    mind -= 25;
  }

  // --- PERMUTATION MATRIX ENGINE FOR USER ARCHETYPE ---
  const userTracks = state.sessionData.focus_areas || state.sessionData.selectedTracks || [];
  let physicalCount = 0;
  let cognitiveCount = 0;
  let mindfulnessCount = 0;

  userTracks.forEach(track => {
    if (track === "Gym & Fitness Training" || track === "Diet & Nutrition Balance") {
      physicalCount += 10;
    } else if (track === "Focus, Discipline & Study") {
      cognitiveCount += 10;
    } else if (track === "Sleep & Circadian Rhythm" || track === "Mental Health & Inner Peace" || track === "Relationships & Social Life") {
      mindfulnessCount += 10;
    }
  });

  let dominantTrack = "";
  if (physicalCount > cognitiveCount && physicalCount > mindfulnessCount) {
    dominantTrack = "PHYSICAL";
  } else if (cognitiveCount > physicalCount && cognitiveCount > mindfulnessCount) {
    dominantTrack = "COGNITIVE";
  } else if (mindfulnessCount > physicalCount && mindfulnessCount > cognitiveCount) {
    dominantTrack = "MINDFULNESS";
  } else {
    dominantTrack = "MIXED";
  }

  if (userTracks.length >= 4) {
    dominantTrack = "MIXED";
  }

  const mindsetState = state.sessionData.general_responses?.identity || "";
  let userArchetype = "";

  if (mindsetState.includes("rebuild my life")) {
    if (dominantTrack === "PHYSICAL") userArchetype = "THE BASELINE KINETIC";
    else if (dominantTrack === "COGNITIVE") userArchetype = "THE METHODICAL MIND";
    else if (dominantTrack === "MINDFULNESS") userArchetype = "THE RENEWING SPIRIT";
    else userArchetype = "THE RECOVERY CATALYST";
  } else if (mindsetState.includes("disciplined and consistent")) {
    if (dominantTrack === "PHYSICAL") userArchetype = "THE IRON PILLAR";
    else if (dominantTrack === "COGNITIVE") userArchetype = "THE ARCHITECT OF FOCUS";
    else if (dominantTrack === "MINDFULNESS") userArchetype = "THE STOIC GUARDIAN";
    else userArchetype = "THE UNSHAKEABLE PILLAR";
  } else if (mindsetState.includes("unlock my full potential") || mindsetState.includes("high-performance lifestyle")) {
    if (dominantTrack === "PHYSICAL") userArchetype = "THE APEX BIOTYPE";
    else if (dominantTrack === "COGNITIVE") userArchetype = "THE COGNITIVE OVERLORD";
    else if (dominantTrack === "MINDFULNESS") userArchetype = "THE TRANSCENDENT CORE";
    else userArchetype = "THE APEX HYBRID";
  } else if (mindsetState.includes("peace and balance")) {
    if (dominantTrack === "PHYSICAL") userArchetype = "THE WARRIOR MONK";
    else if (dominantTrack === "COGNITIVE") userArchetype = "THE SERENE STRATEGIST";
    else if (dominantTrack === "MINDFULNESS") userArchetype = "THE ZENITH ASCETIC";
    else userArchetype = "THE HARMONIOUS SOVEREIGN";
  } else if (mindsetState.includes("transform myself completely")) {
    if (dominantTrack === "PHYSICAL") userArchetype = "THE KINETIC VANGUARD";
    else if (dominantTrack === "COGNITIVE") userArchetype = "THE NEURAL EVOLUTIONARY";
    else if (dominantTrack === "MINDFULNESS") userArchetype = "THE SOVEREIGN MIND";
    else userArchetype = "THE SOVEREIGN CORE";
  }

  userArchetype = userArchetype || "THE UNSHAKEABLE PILLAR";
  state.sessionData.userArchetype = userArchetype;

  // --- ABSOLUTE MATH BOUNDARY GUARDS (Strict Floor [15%] and Ceiling [100%]) ---
  body = Math.min(100, Math.max(15, body));
  fuel = Math.min(100, Math.max(15, fuel));
  rest = Math.min(100, Math.max(15, rest));
  mind = Math.min(100, Math.max(15, mind));
  purpose = Math.min(100, Math.max(15, purpose));
  connection = Math.min(100, Math.max(15, connection));

  // --- GLOBAL COMPETITIVE RANK TIER CALCULATION ---
  const globalAverage = (purpose + connection + body + rest + fuel + mind) / 6;
  let userRank = "DISCIPLINE BEGINNER";
  let rankColor = "#FFA500";

  if (globalAverage >= 0 && globalAverage <= 39) {
    userRank = "RECOVERY NOOB";
    rankColor = "#FF3333";
  } else if (globalAverage >= 40 && globalAverage <= 59) {
    userRank = "DISCIPLINE BEGINNER";
    rankColor = "#FFA500";
  } else if (globalAverage >= 60 && globalAverage <= 74) {
    userRank = "CONSISTENT COMPETITOR";
    rankColor = "#FFFF00";
  } else if (globalAverage >= 75 && globalAverage <= 89) {
    userRank = "ADVANCED PERFORMER";
    rankColor = "#00FF66";
  } else if (globalAverage >= 90 && globalAverage <= 100) {
    userRank = "APEX SOVEREIGN";
    rankColor = "#00FFFF";
  }

  state.sessionData.userRank = userRank || "DISCIPLINE BEGINNER";
  state.sessionData.rankColor = rankColor || "#FFA500";

  return { body, mind, rest, fuel, connection, purpose };
}

// SCREEN: Premium Profile & Dynamic Life Map Radar Visualizer
// SCREEN: Premium Profile & Dynamic Life Map Radar Visualizer
function renderProfileLifeMap(viewWrap) {
  const scores = calculateLifeMapMetrics();
  
  // Simple hex to rgb converter for custom styles
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
  }

  // Helper to determine dynamic glowing colors based on scores
  function getScoreColorStyle(score) {
    if (score >= 70) return { hex: '#30D158', cls: 'score-high' };
    if (score >= 40) return { hex: '#FFD60A', cls: 'score-mid' };
    return { hex: '#FF453A', cls: 'score-low' };
  }

  const dimensionsList = [
    { key: 'purpose', label: 'PURPOSE', desc: 'Focus & Life Intent', icon: 'target' },
    { key: 'connection', label: 'CONNECTION', desc: 'Relationships & Social Vigor', icon: 'users' },
    { key: 'body', label: 'BODY', desc: 'Fitness & Physical Stamina', icon: 'activity' },
    { key: 'rest', label: 'REST', desc: 'Circadian Rest & Inner Peace', icon: 'moon' },
    { key: 'fuel', label: 'FUEL', desc: 'Nutrition & Dietary Balance', icon: 'flame' },
    { key: 'mind', label: 'MIND', desc: 'Attention Span & Discipline', icon: 'brain' }
  ];

  const sidebarHtml = dimensionsList.map(dim => {
    const scoreVal = Math.round(scores[dim.key]);
    const styleInfo = getScoreColorStyle(scoreVal);
    return `
      <div class="lifemap-dimension-item glow-card">
        <div class="lifemap-dim-left">
          <div class="lifemap-dim-icon-box" style="color: ${styleInfo.hex}; border-color: rgba(${hexToRgb(styleInfo.hex)}, 0.18); background: rgba(${hexToRgb(styleInfo.hex)}, 0.04);">
            <i data-lucide="${dim.icon}"></i>
          </div>
          <div class="lifemap-dim-details">
            <span class="lifemap-dim-name">${dim.label}</span>
            <span class="lifemap-dim-desc">${dim.desc}</span>
          </div>
        </div>
        <div class="lifemap-dim-score ${styleInfo.cls}">
          ${scoreVal}<span class="score-denominator">/100</span>
        </div>
      </div>
    `;
  }).join('');

  viewWrap.innerHTML = `
    <div class="question-header">
      <span class="question-pre">Identity Fusion</span>
      <h2 class="question-title">Your Life Map</h2>
      <p class="question-desc">We have compiled a baseline heuristic of your biological and cognitive habits across six core dimensions.</p>
    </div>

    <div class="profile-map-layout">
      <!-- Left Side: Sidebar of dimensions -->
      <div class="lifemap-sidebar animate-fade-in">
        ${sidebarHtml}
      </div>

      <!-- Right Side: Radar Chart Visualizer (Seamless Floating) -->
      <div class="lifemap-chart-floating-container animate-fade-in">
        <div class="map-canvas-container">
          <canvas id="life-map-canvas"></canvas>
        </div>
      </div>
    </div>

    <div class="action-bar">
      <button id="btn-lock-profile" class="btn-premium primary">
        <span>Continue to Insights</span>
        <i data-lucide="arrow-right"></i>
      </button>
    </div>
  `;

  lucide.createIcons();

  const canvas = viewWrap.querySelector('#life-map-canvas');
  const ctx = canvas.getContext('2d');

  // Handle high DPI display for ultra-sharp canvas rendering
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 640 * dpr;
  canvas.height = 640 * dpr;
  ctx.scale(dpr, dpr);

  const cx = 320;
  const cy = 320;
  const maxRadius = 225;
  const dimensions = [
    { key: 'body', label: 'BODY' },
    { key: 'mind', label: 'MIND' },
    { key: 'rest', label: 'REST' },
    { key: 'fuel', label: 'FUEL' },
    { key: 'connection', label: 'CONNECTION' },
    { key: 'purpose', label: 'PURPOSE' }
  ];
  const totalAxes = dimensions.length;
  const angleStep = (Math.PI * 2) / totalAxes;
  const startAngle = -Math.PI / 2; // Point straight up

  // Animation parameters
  let animationProgress = 0;
  const animationDuration = 800; // ms
  const startTime = performance.now();

  function drawRadar(progress) {
    ctx.clearRect(0, 0, 640, 640);

    // 1. Draw Concentric Grid Rings (Hexagons)
    const rings = 5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let r = 1; r <= rings; r++) {
      const radius = (r / rings) * maxRadius;
      ctx.beginPath();
      for (let i = 0; i < totalAxes; i++) {
        const x = cx + Math.cos(startAngle + i * angleStep) * radius;
        const y = cy + Math.sin(startAngle + i * angleStep) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();

      // Add small numeric scale markings on the vertical top axis
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = "9px 'Plus Jakarta Sans', sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText((r * 20).toString(), cx, cy - radius + 3);
    }

    // 2. Draw Axis Lines & Outer Labels
    for (let i = 0; i < totalAxes; i++) {
      const angle = startAngle + i * angleStep;
      const xOuter = cx + Math.cos(angle) * maxRadius;
      const yOuter = cy + Math.sin(angle) * maxRadius;

      // Axis Line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(xOuter, yOuter);
      ctx.stroke();

      // Labels Text
      const dim = dimensions[i];
      const score = Math.round(scores[dim.key]);
      const styleInfo = getScoreColorStyle(score);
      const labelRadius = maxRadius + 24;
      const labelX = cx + Math.cos(angle) * labelRadius;
      const labelY = cy + Math.sin(angle) * labelRadius;

      // Text Alignment calculations to keep labels centered beautifully
      const cos = Math.cos(angle);
      if (Math.abs(cos) < 0.1) ctx.textAlign = 'center';
      else if (cos > 0) ctx.textAlign = 'left';
      else ctx.textAlign = 'right';

      ctx.textBaseline = 'middle';

      // Dimension Name
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = "bold 11px 'Outfit', sans-serif";
      ctx.fillText(dim.label, labelX, labelY - 7);

      // Score Number with dynamic conditional colors
      ctx.fillStyle = styleInfo.hex;
      ctx.font = "bold 12px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText(`${score}/100`, labelX, labelY + 7);
    }

    // 3. Plot Connected Data Area Polygon
    const points = [];
    for (let i = 0; i < totalAxes; i++) {
      const angle = startAngle + i * angleStep;
      const dim = dimensions[i];
      // Animate score coordinates scaling outwards from center
      const currentScore = scores[dim.key] * progress;
      const radius = (currentScore / 100) * maxRadius;
      points.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius
      });
    }

    // Fill Path with glowing gradient
    ctx.beginPath();
    points.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    
    const fillGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, maxRadius);
    fillGrad.addColorStop(0, 'rgba(99, 102, 241, 0.08)');  // Indigo base
    fillGrad.addColorStop(0.5, 'rgba(139, 92, 246, 0.22)'); // Purple mid
    fillGrad.addColorStop(1, 'rgba(6, 182, 212, 0.35)');    // Cyan neon edge
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Neon Stroke
    ctx.strokeStyle = '#06b6d4'; // Cyan stroke
    ctx.lineWidth = 3;
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#06b6d4';
    ctx.stroke();
    ctx.shadowBlur = 0; // reset

    // 4. Draw glowing dots at vertices
    points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#8b5cf6';
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0; // reset
    });
  }

  // Animation Loop using requestAnimationFrame
  function animateRadar(time) {
    const elapsed = time - startTime;
    animationProgress = Math.min(1, elapsed / animationDuration);

    // Easing function (cubic Out)
    const ease = 1 - Math.pow(1 - animationProgress, 3);

    drawRadar(ease);

    if (animationProgress < 1) {
      requestAnimationFrame(animateRadar);
    }
  }

  // Kick off chart animation loop
  requestAnimationFrame(animateRadar);

  // Lock-in and continue submission
  viewWrap.querySelector('#btn-lock-profile').addEventListener('click', (e) => {
    e.preventDefault();

    // Calculate & save life map dimensions directly into the session database schema
    state.sessionData.life_map = scores;

    // Write state to IndexedDB securely
    saveSession(state.sessionData)
      .then(() => {
        updateDBInspectorBadge();
      })
      .catch(err => console.error("Database write error:", err));

    // Advance to next cinematic insights card
    advanceStep();
  });
}

// SCREEN: "Friction & Strategy Analysis" Insights Page
function renderWhatsHoldingYouBack(viewWrap) {
  const analysis = generateAIPersonalityAnalysis();

  viewWrap.className = 'page-view';
  viewWrap.innerHTML = `
    <div class="question-header" style="margin-bottom: 24px;">
      <span class="question-pre">Friction & Strategy Analysis</span>
      <h2 class="question-title">Friction & Strategy Analysis</h2>
      <p class="question-desc" style="margin-bottom: 0;">We have identified your primary physical and cognitive bottlenecks and mapped direct counter-strategy protocols.</p>
    </div>

    <!-- 2-Column Responsive Layout Container Grid -->
    <div class="friction-analysis-layout-grid">
      
      <!-- COLUMN 1: Stoic Truth & Stagnation Loop (40% Width) -->
      <div class="friction-column-left">
        <div class="friction-card-header">
          <span class="friction-card-pre">Stoic Truth</span>
          <h3 class="friction-card-title">What Most People Never Realize</h3>
        </div>

        <div class="stagnation-timeline">
          <span class="stagnation-title">THE STAGNATION LOOP</span>
          
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

        <div class="breaking-cycle-box">
          <span class="breaking-cycle-title">WHY YOU ARE BREAKING THE CYCLE</span>
          <p class="breaking-cycle-desc">
            95% of people quit because they rely on emotional inspiration to do hard things. They build massive plans but build zero self-awareness. By choosing to deconstruct your day honestly, you have already bypassed the first gate. We are not building a motivation plan; we are assembling a resilient habits system.
          </p>
        </div>
      </div>

      <!-- COLUMN 2: Personalized Elements (60% Width) -->
      <div class="friction-column-right">
        
        <!-- Top Half: Your Identified Bottlenecks -->
        <div class="bottlenecks-section">
          <h3 class="plan-helpers-header" style="text-align: left; margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #fff;">Your Identified Bottlenecks</h3>
          <div class="plan-helpers-grid" style="grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 0;">
            ${analysis.struggles.map(s => `
              <div class="struggle-item" style="flex-direction: column; gap: 8px; padding: 16px; text-align: left; border-left: none; border-bottom: 3px solid rgba(239, 68, 68, 0.4); margin-bottom: 0; min-height: 110px;">
                <div class="struggle-icon-box" style="margin: 0 0 4px; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: #ff453a;">
                  <i data-lucide="${s.icon}"></i>
                </div>
                <div class="struggle-details">
                  <span class="struggle-title" style="font-size: 14px; text-align: left; display: block; font-weight: 600; color: #fff;">${s.title}</span>
                  <p class="struggle-desc" style="font-size: 12px; text-align: left; line-height: 1.4; margin-top: 4px; color: var(--text-secondary);">${s.desc}</p>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Bottom Half: How Your Plan Will Help -->
        <div class="helpers-section">
          <h3 class="plan-helpers-header" style="text-align: left; margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #fff;">How Your Plan Will Help</h3>
          <div class="plan-helpers-grid" style="grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 0;">
            <div class="plan-helper-card glow-card" style="padding: 16px;">
              <i data-lucide="anchor" class="plan-helper-icon" style="font-size: 18px; margin-bottom: 8px;"></i>
              <span class="plan-helper-title" style="font-size: 13px; font-weight: 600; display: block; margin-bottom: 4px;">Habit Anchoring</span>
              <p class="plan-helper-desc" style="font-size: 11px; margin: 0; line-height: 1.4; color: var(--text-secondary);">Frictionless 5-minute micro-habits that bypass your brain's action resistance.</p>
            </div>

            <div class="plan-helper-card glow-card" style="padding: 16px;">
              <i data-lucide="shield" class="plan-helper-icon" style="font-size: 18px; margin-bottom: 8px;"></i>
              <span class="plan-helper-title" style="font-size: 13px; font-weight: 600; display: block; margin-bottom: 4px;">Friction Insulation</span>
              <p class="plan-helper-desc" style="font-size: 11px; margin: 0; line-height: 1.4; color: var(--text-secondary);">Systematic rules to lock out environments and digital loops that trigger procrastination.</p>
            </div>

            <div class="plan-helper-card glow-card" style="padding: 16px;">
              <i data-lucide="trending-up" class="plan-helper-icon" style="font-size: 18px; margin-bottom: 8px;"></i>
              <span class="plan-helper-title" style="font-size: 13px; font-weight: 600; display: block; margin-bottom: 4px;">Consistency Scaling</span>
              <p class="plan-helper-desc" style="font-size: 11px; margin: 0; line-height: 1.4; color: var(--text-secondary);">Gradual progression models that increase routine demands only after self-trust stabilizes.</p>
            </div>
          </div>
        </div>

      </div>

    </div>

    <div class="action-bar" style="margin-top: 24px;">
      <button id="btn-submit-struggles" class="btn-premium primary">
        <span>Continue to Roadmap →</span>
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

// SCREEN: Algorithmic Roadmap Synthesis Screen
function renderRoadmapScreen(viewWrap) {
  // First, generate the algorithmically tailored self-improvement roadmap
  const roadmap = compileAlgorithmRoadmap();
  state.sessionData.generated_roadmap = roadmap;

  const userRank = state.sessionData.userRank || "DISCIPLINE BEGINNER";
  const rankColor = state.sessionData.rankColor || "#FFA500";
  const userArchetype = state.sessionData.userArchetype || "THE UNSHAKEABLE PILLAR";

  // Persist session to database (IndexedDB)
  saveSession(state.sessionData)
    .then(() => {
      updateDBInspectorBadge();
    })
    .catch(err => console.error("Database Save Failed:", err));

  const milestoneDetails = [
    {
      days: "Days 1-7",
      title: roadmap.stage_1,
      desc: "Establishing physical baselines, low-friction circadian habits, and clean initial routine triggers designed to build immediate momentum with zero routine resistance.",
      icon: "activity"
    },
    {
      days: "Days 8-21",
      title: roadmap.stage_2,
      desc: "Isolating concentration windows, blocking dopamine spikes, and shielding cognitive reserves from leaks, insulating your attention during high-impact blocks.",
      icon: "shield"
    },
    {
      days: "Days 22-45",
      title: roadmap.stage_3,
      desc: "Assembling automatic Stoic daily systems and habit reflexes that operate independently of mood, shifting action triggers from conscious effort to neural reflexes.",
      icon: "zap"
    },
    {
      days: "Days 46+",
      title: roadmap.stage_4,
      desc: "Unlocking peak scalability and compounding gains in professional, physical, and mindset domains, giving you ultimate sovereignty and lifetime autonomy.",
      icon: "target"
    }
  ];

  // Render the final confirmation view directly (no fake AI calculations loader delay!)
  viewWrap.className = 'page-view';
  viewWrap.innerHTML = `
    <div class="roadmap-container">
      <div class="pulse-sparkle-box">
        <i data-lucide="sparkles"></i>
      </div>
      
      <span class="roadmap-badge">Onboarding Complete</span>
      <h2 class="welcome-title" style="font-size: 38px; letter-spacing:-1px;">Your Ascent Roadmap</h2>
      <p class="welcome-subtitle" style="font-size: 15px; margin-bottom: 24px;">Welcome, ${state.sessionData.basic_info.first_name || 'my friend'}. Here is your customized timeline progression for the <strong>${userArchetype}</strong> protocol.</p>
      
      <div class="roadmap-card" style="margin-top: 0; padding-top: 24px; padding-bottom: 24px;">
        <!-- Center Gamification Display Block -->
        <div class="gamified-rank-block" style="text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
          <span class="gamified-rank-title" style="display: block; font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 900; letter-spacing: 3px; color: ${rankColor}; text-shadow: 0 0 20px ${rankColor}88, 0 0 40px ${rankColor}44; text-transform: uppercase;">${userRank}</span>
          <span class="gamified-archetype-subtitle" style="display: block; font-family: 'Outfit', sans-serif; font-size: 14px; font-weight: 700; color: #ffffff; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 6px; opacity: 0.9;">${userArchetype}</span>
        </div>
        
        <p class="roadmap-desc" style="margin-bottom: 24px; padding-bottom: 16px; font-size: 14px;">${roadmap.letter}</p>

        <!-- 4-Phase Horizontal Timeline View in the center -->
        <div class="preview-timeline" style="margin-bottom: 24px;">
          ${milestoneDetails.map((m, idx) => `
            <div class="timeline-node ${idx === 0 ? 'active' : ''}" data-idx="${idx}">
              <div class="timeline-node-icon">
                <i data-lucide="${m.icon}"></i>
              </div>
              <span class="timeline-node-days">${m.days}</span>
              <span class="timeline-node-title" style="font-size: 12px; line-height: 1.3;">${m.title.split(' & ')[0].split(' - ')[0]}</span>
            </div>
          `).join('')}
        </div>

        <!-- Active Details Display Box -->
        <div class="preview-detail-card" id="detail-card" style="margin-bottom: 0; min-height: 120px; padding: 20px;">
          <div class="preview-detail-icon-box" id="detail-icon-box">
            <i data-lucide="${milestoneDetails[0].icon}"></i>
          </div>
          <div class="preview-detail-content">
            <span class="preview-detail-header" id="detail-header">${milestoneDetails[0].days}</span>
            <span class="preview-detail-title" id="detail-title" style="font-size: 16px;">${milestoneDetails[0].title}</span>
            <p class="preview-detail-desc" id="detail-desc" style="font-size: 13px; margin: 0; line-height: 1.5; color: var(--text-secondary);">${milestoneDetails[0].desc}</p>
          </div>
        </div>
      </div>
      
      <div class="action-bar" style="margin-top: 30px;">
        <button id="btn-enter-life" class="btn-premium primary" style="min-width: 280px;">
          <span>Enter Your New Life →</span>
          <i data-lucide="shield-check"></i>
        </button>
      </div>
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
      }, 150);
    });
  });

  viewWrap.querySelector('#btn-enter-life').addEventListener('click', () => {
    renderUserDashboard(viewWrap);
  });
}

function compileAlgorithmRoadmap() {
  const info = state.sessionData.basic_info;
  const stateVal = state.sessionData.life_state || [];
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
  calculateLifeMapMetrics();
  const archetype = state.sessionData.userArchetype || 'THE UNSHAKEABLE PILLAR';
  
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

  if (chosenAreas.includes('Physical Health & Fitness') || chosenAreas.includes('Gym & Fitness Training')) {
    stage1 = challengePrefix1 + 'Circadian Reset & Dynamic Movement';
  }
  if ((chosenAreas.includes('Sleep & Energy') || chosenAreas.includes('Sleep & Circadian Rhythm')) && flowAns.sleep_state && flowAns.sleep_state.includes('Pretty bad')) {
    stage1 = challengePrefix1 + 'Circadian Sync & Sleep Routine Setup';
  }
  
  if (chosenAreas.includes('Focus & Productivity') || chosenAreas.includes('Education & Learning') || chosenAreas.includes('Focus, Discipline & Study')) {
    stage2 = challengePrefix2 + 'Attention Anchoring & Distraction Shielding';
  }
  
  if (chosenAreas.includes('Discipline & Consistency') || chosenAreas.includes('Motivation & Purpose') || chosenAreas.includes('Focus, Discipline & Study')) {
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
  if (_isTransitioning) return; // Block index incrementing while slide transitions are active
  if (state.currentStepIndex < state.activeQueue.length - 1) {
    state.currentStepIndex++;
    renderActiveStep();
  }
}

function handleBackNavigation() {
  if (_isTransitioning) return; // Block index decrementing while slide transitions are active
  if (state.currentStepIndex > 0) {
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

// Premium toast notification helper
function showNotification(message) {
  let toast = document.getElementById('kairos-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'kairos-toast';
    toast.className = 'kairos-notification';
    document.body.appendChild(toast);
  }
  
  toast.innerHTML = `
    <div class="kairos-notification-icon">
      <i data-lucide="alert-triangle"></i>
    </div>
    <span class="kairos-notification-text">${message}</span>
  `;
  
  // Render Lucide icons in toast
  if (window.lucide) {
    lucide.createIcons();
  }
  
  // Trigger animations
  toast.classList.remove('show');
  void toast.offsetWidth; // Force reflow
  toast.classList.add('show');
  
  // Clear any existing timeout
  if (toast.timeoutId) {
    clearTimeout(toast.timeoutId);
  }
  
  toast.timeoutId = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// --- Dynamic Personalized User Dashboard Workspace ---
function renderUserDashboard(viewWrap) {
  // Hide standard onboarding header
  const header = document.getElementById('app-header');
  if (header) header.classList.remove('visible');
  
  viewWrap.className = 'dashboard-layout-container';
  
  // Calculate and bind Life Map metrics
  const scores = calculateLifeMapMetrics();

  const focus = state.sessionData.focus_areas || state.sessionData.selectedTracks || [];
  const first_name = state.sessionData.basic_info?.first_name || 'Achiever';
  const archetype = state.sessionData.userArchetype || 'THE UNSHAKEABLE PILLAR';
  const userRank = state.sessionData.userRank || "DISCIPLINE BEGINNER";
  const rankColor = state.sessionData.rankColor || "#FFA500";
  
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
  }

  function getScoreColorStyle(score) {
    if (score >= 70) return { hex: '#30D158', cls: 'score-high' };
    if (score >= 40) return { hex: '#FFD60A', cls: 'score-mid' };
    return { hex: '#FF453A', cls: 'score-low' };
  }

  const dimensionsList = [
    { key: 'purpose', label: 'PURPOSE', desc: 'Focus & Life Intent', icon: 'target' },
    { key: 'connection', label: 'CONNECTION', desc: 'Relationships & Social Vigor', icon: 'users' },
    { key: 'body', label: 'BODY', desc: 'Fitness & Physical Stamina', icon: 'activity' },
    { key: 'rest', label: 'REST', desc: 'Circadian Rest & Inner Peace', icon: 'moon' },
    { key: 'fuel', label: 'FUEL', desc: 'Nutrition & Dietary Balance', icon: 'flame' },
    { key: 'mind', label: 'MIND', desc: 'Attention Span & Discipline', icon: 'brain' }
  ];

  const sidebarHtml = dimensionsList.map(dim => {
    const scoreVal = Math.round(scores[dim.key] || 85);
    const styleInfo = getScoreColorStyle(scoreVal);
    return `
      <div class="lifemap-dimension-item glow-card" style="padding: 10px 14px; margin-bottom: 0;">
        <div class="lifemap-dim-left">
          <div class="lifemap-dim-icon-box" style="width:34px; height:34px; font-size:14px; color: ${styleInfo.hex}; border-color: rgba(${hexToRgb(styleInfo.hex)}, 0.18); background: rgba(${hexToRgb(styleInfo.hex)}, 0.04);">
            <i data-lucide="${dim.icon}"></i>
          </div>
          <div class="lifemap-dim-details">
            <span class="lifemap-dim-name" style="font-size:11px;">${dim.label}</span>
            <span class="lifemap-dim-desc" style="font-size:10px;">${dim.desc}</span>
          </div>
        </div>
        <div class="lifemap-dim-score ${styleInfo.cls}" style="font-size:13px;">
          ${scoreVal}<span class="score-denominator" style="font-size:9px;">/100</span>
        </div>
      </div>
    `;
  }).join('');

  // --- Personalized Dynamic Program & Tracking Matrix Setup ---
  const dailyTasksMap = {
    'Gym & Fitness Training': {
      text: "Complete 90-minute structured physical training split block",
      dim: "body"
    },
    'Diet & Nutrition Balance': {
      text: "Log all meals in natural language & maintain positive protein buffer",
      dim: "fuel"
    },
    'Sleep & Circadian Rhythm': {
      text: "Lock screen & protect melatonin boundary before Circadian Sunset",
      dim: "rest"
    },
    'Focus, Discipline & Study': {
      text: "Execute 2 Pomodoro focus sessions & clear Dominant Task Queue",
      dim: "mind"
    },
    'Mental Health & Inner Peace': {
      text: "Perform somatic breathwork down-regulation & write Morning brain-dump",
      dim: "purpose"
    },
    'Relationships & Social Life': {
      text: "Verify Inner Circle check-ins & check Social Battery outward capacity",
      dim: "connection"
    }
  };

  const weeklyMissionsMap = {
    'Gym & Fitness Training': {
      text: "Complete 3 structured workout sessions without friction",
      dim: "body"
    },
    'Diet & Nutrition Balance': {
      text: "Log clean nutrition macros consistently for 5 days",
      dim: "fuel"
    },
    'Sleep & Circadian Rhythm': {
      text: "Secure solid sleep gates timeline with zero bedtime procrastination",
      dim: "rest"
    },
    'Focus, Discipline & Study': {
      text: "Conquer all study tasks without tabs-switching friction",
      dim: "mind"
    },
    'Mental Health & Inner Peace': {
      text: "Synthesize cognitive clarity anchors every single morning",
      dim: "purpose"
    },
    'Relationships & Social Life': {
      text: "Ensure all close family/friend connections are fully Synchronized",
      dim: "connection"
    }
  };

  let dailyItemsHtml = '';
  let weeklyItemsHtml = '';

  focus.forEach((track, index) => {
    const dailyInfo = dailyTasksMap[track];
    if (dailyInfo) {
      dailyItemsHtml += `
        <div class="task-item-card daily-track-item" data-dim="${dailyInfo.dim}" data-index="${index}" style="margin-bottom:0; background:rgba(0,0,0,0.2);">
          <div class="task-item-left">
            <div class="task-checkbox tracking-chk"><i data-lucide="check"></i></div>
            <span class="task-text" style="font-size:12px;">${dailyInfo.text}</span>
          </div>
        </div>
      `;
    }

    const weeklyInfo = weeklyMissionsMap[track];
    if (weeklyInfo) {
      weeklyItemsHtml += `
        <div class="task-item-card weekly-track-item" data-dim="${weeklyInfo.dim}" data-index="${index}" style="margin-bottom:0; background:rgba(0,0,0,0.2);">
          <div class="task-item-left">
            <div class="task-checkbox tracking-chk"><i data-lucide="check"></i></div>
            <span class="task-text" style="font-size:12px;">${weeklyInfo.text}</span>
          </div>
        </div>
      `;
    }
  });

  if (dailyItemsHtml === '') {
    dailyItemsHtml = `
      <div style="font-size:11px; color:var(--text-secondary); text-align:center; padding:16px;">
        No active focus areas enqueued. Choose tracks to populate.
      </div>
    `;
  }
  if (weeklyItemsHtml === '') {
    weeklyItemsHtml = `
      <div style="font-size:11px; color:var(--text-secondary); text-align:center; padding:16px;">
        No active focus areas enqueued. Choose tracks to populate.
      </div>
    `;
  }

  // Build the conditional widgets feed
  let widgetsHtml = `
    <div class="dashboard-widget-card wide-console animate-fade-in" style="background: rgba(10, 15, 30, 0.45); border-color: rgba(6, 182, 212, 0.15);">
      <div class="widget-header-group">
        <div class="widget-icon-box accent-cyan">
          <i data-lucide="shield-check"></i>
        </div>
        <div class="widget-header-details">
          <span class="widget-title">Personalized Program Tracking Matrix</span>
          <span class="widget-subtitle">Interactive daily execution & weekly core missions tracker</span>
        </div>
      </div>
      
      <div class="tracking-matrix-layout" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; width: 100%;">
        <!-- Daily Execution List -->
        <div class="tracking-section-block" style="display:flex; flex-direction:column; gap:10px;">
          <div class="tracking-block-title" style="display:flex; align-items:center; gap:8px; font-weight:700; color:var(--text-white); font-size:13px; margin-bottom:4px; letter-spacing:0.5px; text-transform:uppercase; font-family:'Outfit', sans-serif;">
            <i data-lucide="sun" style="width:14px; color:#ffd60a;"></i>
            <span>Daily Execution Protocol</span>
          </div>
          <div class="tracking-list-feed" id="daily-matrix-container" style="display:flex; flex-direction:column; gap:8px;">
            ${dailyItemsHtml}
          </div>
        </div>
        
        <!-- Weekly Missions List -->
        <div class="tracking-section-block" style="display:flex; flex-direction:column; gap:10px;">
          <div class="tracking-block-title" style="display:flex; align-items:center; gap:8px; font-weight:700; color:var(--text-white); font-size:13px; margin-bottom:4px; letter-spacing:0.5px; text-transform:uppercase; font-family:'Outfit', sans-serif;">
            <i data-lucide="calendar" style="width:14px; color:var(--accent-indigo);"></i>
            <span>Weekly Core Missions</span>
          </div>
          <div class="tracking-list-feed" id="weekly-matrix-container" style="display:flex; flex-direction:column; gap:8px;">
            ${weeklyItemsHtml}
          </div>
        </div>
      </div>
    </div>
  `;
  
  // WIDGET 4: StudyVaultConsole pomodoro & Tasks (Render at top of feed)
  if (focus.includes('Focus, Discipline & Study')) {
    widgetsHtml += `
      <div class="dashboard-widget-card wide-console animate-fade-in">
        <div class="widget-header-group">
          <div class="widget-icon-box accent-cyan">
            <i data-lucide="zap"></i>
          </div>
          <div class="widget-header-details">
            <span class="widget-title">Study & Focus Vault Console</span>
            <span class="widget-subtitle">Interactive Pomodoro & task prioritization matrix</span>
          </div>
        </div>
        
        <div class="pomodoro-container">
          <div class="pomodoro-timer-block">
            <span class="pomodoro-time-display" id="pomodoro-time">25:00</span>
            <div class="pomodoro-controls">
              <button class="pomodoro-btn" id="btn-pomodoro-toggle">
                <i data-lucide="play" id="pomodoro-icon"></i>
                <span id="pomodoro-toggle-txt">Start Session</span>
              </button>
              <button class="pomodoro-btn" id="btn-pomodoro-reset">
                <i data-lucide="rotate-ccw"></i>
                <span>Reset</span>
              </button>
            </div>
          </div>
          
          <div class="task-prioritizer-block">
            <span class="widget-title" style="font-size: 14px;">Dominant Focus Task Queue</span>
            <div class="task-input-row">
              <input type="text" id="task-input-field" class="task-input" placeholder="Type a critical study/work task...">
              <button class="btn-task-add" id="btn-add-task">
                <i data-lucide="plus"></i>
              </button>
            </div>
            <div class="tasks-list-feed" id="tasks-list-container">
              <div class="task-item-card">
                <div class="task-item-left">
                  <div class="task-checkbox" data-id="1"><i data-lucide="check"></i></div>
                  <span class="task-text">Complete deep work logic synthesis block</span>
                </div>
                <button class="btn-task-delete"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // WIDGET 1: FitnessTrackerWidget
  if (focus.includes('Gym & Fitness Training')) {
    const env = state.sessionData.flow_responses?.gym_q1 || 'Outdoors / Inactive';
    const splitTarget = state.sessionData.flow_responses?.gym_q2 || '1–3 days a week.';
    
    let daysHtml = '';
    if (splitTarget.includes('4–6') || splitTarget.includes('4-6') || splitTarget.includes('7 or more')) {
      daysHtml = `
        <div class="split-day-card">
          <span class="split-day-title">Day 1</span>
          <span class="split-day-focus">Upper Body Strength</span>
          <span class="split-day-exercises">Bench Press: 3x8<br>Weighted Pullups: 3x6<br>Shoulder Press: 3x8</span>
        </div>
        <div class="split-day-card">
          <span class="split-day-title">Day 2</span>
          <span class="split-day-focus">Lower Body Power</span>
          <span class="split-day-exercises">Squats: 3x6<br>Romanian Deadlifts: 3x8<br>Calf Raises: 3x15</span>
        </div>
        <div class="split-day-card">
          <span class="split-day-title">Day 3</span>
          <span class="split-day-focus">Conditioning & Core</span>
          <span class="split-day-exercises">KB Swings: 4x15<br>Hanging Leg Raises: 3x12<br>Plank: 3x60s</span>
        </div>
      `;
    } else {
      daysHtml = `
        <div class="split-day-card">
          <span class="split-day-title">Day 1</span>
          <span class="split-day-focus">Full Body (A)</span>
          <span class="split-day-exercises">Squats: 3x8<br>Incline Bench: 3x10<br>Lat Pulldown: 3x10</span>
        </div>
        <div class="split-day-card">
          <span class="split-day-title">Day 2</span>
          <span class="split-day-focus">Full Body (B)</span>
          <span class="split-day-exercises">Deadlifts: 3x5<br>Overhead Press: 3x8<br>Barbell Rows: 3x8</span>
        </div>
        <div class="split-day-card">
          <span class="split-day-title">Day 3</span>
          <span class="split-day-focus">Circadian Cardio</span>
          <span class="split-day-exercises">Steady State Jog: 30m<br>Face Pulls: 3x15<br>Core Hinge Planks</span>
        </div>
      `;
    }

    const formAssistance = state.sessionData.flow_responses?.gym_q3 || [];
    const hasFormHelp = Array.isArray(formAssistance) 
      ? formAssistance.includes("I want to fix my exercise mechanics, form, and lifting execution.")
      : formAssistance === "I want to fix my exercise mechanics, form, and lifting execution.";
      
    widgetsHtml += `
      <div class="dashboard-widget-card animate-fade-in">
        <div class="widget-header-group">
          <div class="widget-icon-box accent-indigo">
            <i data-lucide="activity"></i>
          </div>
          <div class="widget-header-details">
            <span class="widget-title">Physical Fitness Split</span>
            <span class="widget-subtitle">Environment: ${env} | Split: ${splitTarget}</span>
          </div>
        </div>
        
        <div class="training-split-grid">
          ${daysHtml}
        </div>
        
        ${hasFormHelp ? `
          <button class="form-execution-btn" id="btn-show-form-help">
            <i data-lucide="shield"></i>
            <span>Open Form Execution Blueprints</span>
          </button>
        ` : ''}
      </div>
    `;
  }

  // WIDGET 2: FrictionlessNutritionWidget
  if (focus.includes('Diet & Nutrition Balance')) {
    widgetsHtml += `
      <div class="dashboard-widget-card animate-fade-in">
        <div class="widget-header-group">
          <div class="widget-icon-box accent-purple">
            <i data-lucide="apple"></i>
          </div>
          <div class="widget-header-details">
            <span class="widget-title">Frictionless Nutrition Tracker</span>
            <span class="widget-subtitle">AI natural-language single-sentence micro-logging</span>
          </div>
        </div>
        
        <div class="nutrition-widget-content">
          <div class="nutrition-input-group">
            <input type="text" id="nutrition-log-input" class="task-input" placeholder="E.g., had 3 boiled eggs and oatmeal...">
            <button class="btn-nutrition-log" id="btn-log-nutrition">Log Meal</button>
          </div>
          
          <div class="nutrition-tracker-bars">
            <div class="nutrition-bar-label-row">
              <span style="font-weight:600; color: var(--text-white);">Daily Protein Buffer</span>
              <span id="protein-progress-text" style="color: var(--accent-cyan); font-weight:700;">32g / 150g</span>
            </div>
            <div class="nutrition-bar-wrapper">
              <div class="nutrition-bar-fill protein" id="protein-progress-bar" style="width: 21%;"></div>
            </div>
          </div>
          
          <div class="meals-logged-feed" id="nutrition-feed-list">
            <div class="logged-meal-item">
              <span class="logged-meal-text">Initial Calibration Breakfast</span>
              <span>AI Estimate: 32g Protein | 420 kcal</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // WIDGET 3: CircadianClockWidget
  if (focus.includes('Sleep & Circadian Rhythm')) {
    widgetsHtml += `
      <div class="dashboard-widget-card animate-fade-in">
        <div class="widget-header-group">
          <div class="widget-icon-box accent-indigo">
            <i data-lucide="moon"></i>
          </div>
          <div class="widget-header-details">
            <span class="widget-title">Circadian Clock & Sleep Gates</span>
            <span class="widget-subtitle">Circadian alignment timeline & blue-light blockers</span>
          </div>
        </div>
        
        <div class="circadian-widget-content">
          <div class="circadian-timeline-viz">
            <div class="circadian-block sleep" style="width: 33%;">SLEEP GATES (10:30 PM)</div>
            <div class="circadian-block wake" style="width: 67%;">OPTIMAL COGNITIVE WAKE (6:30 AM)</div>
          </div>
          <div class="circadian-timeline-markers">
            <span>10:30 PM (Sleep)</span>
            <span>6:30 AM (Wake)</span>
            <span>10:30 PM (Sleep)</span>
          </div>
          
          <div class="sunset-countdown-card">
            <div style="display:flex; flex-direction:column; gap:2px;">
              <span style="font-size:11px; font-weight:700; text-transform:uppercase; color: var(--text-secondary); letter-spacing:0.5px;">Digital Sunset Lock</span>
              <span style="font-size:13px; font-weight:600; color: var(--text-white);">Melatonin Protection Active</span>
            </div>
            <span class="sunset-timer-display" id="circadian-sunset-countdown">02h 45m 12s</span>
          </div>
        </div>
      </div>
    `;
  }

  // WIDGET 5: MentalClarityWidget
  if (focus.includes('Mental Health & Inner Peace')) {
    widgetsHtml += `
      <div class="dashboard-widget-card animate-fade-in">
        <div class="widget-header-group">
          <div class="widget-icon-box accent-purple">
            <i data-lucide="heart"></i>
          </div>
          <div class="widget-header-details">
            <span class="widget-title">Morning Cognitive Synthesis</span>
            <span class="widget-subtitle">Brain-dump thought deconstruction & somatic breathwork</span>
          </div>
        </div>
        
        <div class="mental-widget-content">
          <textarea class="mental-dump-textarea" id="mental-brain-dump-input" placeholder="Type whatever is cluttering your mind right now. Let it flow without judgment..."></textarea>
          <button class="form-execution-btn" id="btn-synthesize-clarity" style="color: var(--accent-purple); border-color: rgba(139,92,246,0.25); background: rgba(139,92,246,0.08);">
            <i data-lucide="brain"></i>
            <span>Synthesize Clarity Matrix</span>
          </button>
          
          <div class="synthesized-clarity-box" id="synthesized-clarity-container" style="display: none;">
            <div class="synthesized-title">
              <i data-lucide="shield-check"></i>
              <span>Extracted Focus Anchors</span>
            </div>
            <div class="synthesized-list" id="synthesized-clarity-list">
              <!-- Synthesized list elements -->
            </div>
          </div>
          
          <div class="breathwork-card">
            <div class="breathing-circle-wrapper">
              <div class="breathing-circle-glow" id="breathing-glow-node"></div>
            </div>
            <div class="breathing-instructions">
              <span class="breathing-text" id="breathing-txt">Somatic Respiration</span>
              <span class="breathing-phase" id="breathing-phase-txt">Tap start to begin physiological down-regulation</span>
            </div>
            <button class="btn-bond-checkin" id="btn-breathing-toggle">Start</button>
          </div>
        </div>
      </div>
    `;
  }

  // WIDGET 6: InnerCircleReminderCard
  if (focus.includes('Relationships & Social Life')) {
    widgetsHtml += `
      <div class="dashboard-widget-card animate-fade-in">
        <div class="widget-header-group">
          <div class="widget-icon-box accent-cyan">
            <i data-lucide="users"></i>
          </div>
          <div class="widget-header-details">
            <span class="widget-title">Inner Circle Social Battery</span>
            <span class="widget-subtitle">Connection checking loop and social stamina reserves</span>
          </div>
        </div>
        
        <div class="bonds-reminders-list">
          <div class="bond-reminder-item">
            <div class="bond-reminder-row">
              <span class="bond-identity"><i data-lucide="heart" style="width:14px; color:#ff453a;"></i> Inner Family / Parent</span>
              <span class="bond-due-badge" id="badge-bond-1">Check-in Due</span>
            </div>
            <div class="bond-actions-row">
              <div class="bond-progress-wrapper">
                <div class="bond-progress-fill" id="fill-bond-1" style="width: 40%;"></div>
              </div>
              <button class="btn-bond-checkin" data-bond="1">Log check-in</button>
            </div>
          </div>
          
          <div class="bond-reminder-item">
            <div class="bond-reminder-row">
              <span class="bond-identity"><i data-lucide="smile" style="width:14px; color:var(--accent-cyan);"></i> Closest Friend / Partner</span>
              <span class="bond-due-badge checked-in" id="badge-bond-2">Synchronized</span>
            </div>
            <div class="bond-actions-row">
              <div class="bond-progress-wrapper">
                <div class="bond-progress-fill" id="fill-bond-2" style="width: 100%;"></div>
              </div>
              <button class="btn-bond-checkin" data-bond="2">Log check-in</button>
            </div>
          </div>
        </div>
        
        <div class="social-battery-section">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <span style="font-size:11px; font-weight:700; text-transform:uppercase; color: var(--text-secondary); letter-spacing:0.5px;">Social Battery Reserves</span>
            <span style="font-size:13px; font-weight:600; color: var(--text-white);">Cognitive Outward Capacity</span>
          </div>
          <div class="social-battery-container" id="social-battery-blocks">
            <div class="social-battery-segment active" data-idx="0"></div>
            <div class="social-battery-segment active" data-idx="1"></div>
            <div class="social-battery-segment active" data-idx="2"></div>
            <div class="social-battery-segment" data-idx="3"></div>
            <div class="social-battery-segment" data-idx="4"></div>
          </div>
        </div>
      </div>
    `;
  }

  viewWrap.innerHTML = `
    <!-- Left Sidebar: Life Map & Profile Synthesis -->
    <aside class="dashboard-sidebar animate-fade-in">
      <div class="dashboard-profile-banner" style="text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
        <div class="dashboard-avatar-glow">
          <i data-lucide="shield-check"></i>
        </div>
        <span class="dashboard-profile-title" style="font-size: 18px; font-weight: 700; color: #fff; margin: 0;">${first_name}</span>
        
        <!-- Gamified Rank Tier Display -->
        <span class="dashboard-profile-rank" style="font-family: 'Outfit', sans-serif; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: ${rankColor}; text-shadow: 0 0 10px ${rankColor}66, 0 0 20px ${rankColor}33; text-transform: uppercase; margin-top: 2px;">${userRank}</span>
        
        <span class="dashboard-profile-archetype" style="font-family: 'Outfit', sans-serif; font-size: 10px; font-weight: 600; letter-spacing: 0.5px; color: rgba(255, 255, 255, 0.7); text-transform: uppercase; margin-top: 2px;">${archetype}</span>
      </div>
      
      <div class="lifemap-dashboard-canvas-box">
        <canvas id="life-map-canvas-dashboard"></canvas>
      </div>
      
      <div class="lifemap-sidebar-list" style="display:flex; flex-direction:column; gap:10px;">
        ${sidebarHtml}
      </div>
      
      <button class="btn-premium" id="btn-dashboard-reset" style="background: rgba(255, 69, 58, 0.04); border-color: rgba(255, 69, 58, 0.2); color: #ff453a; width: 100%; border-radius: 14px; padding: 12px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.3s ease;">
        <i data-lucide="rotate-ccw"></i>
        <span>Reset & Retake Diagnostic</span>
      </button>
    </aside>
    
    <!-- Right Main Feed: Grid of Personalized Widgets -->
    <main class="dashboard-main-grid">
      ${widgetsHtml}
    </main>

    <!-- Custom Modal Overlay (squats execution blueprints etc) -->
    <div class="premium-modal-overlay" id="dashboard-modal-overlay">
      <div class="premium-modal-content">
        <div class="modal-header">
          <span class="modal-title" id="dashboard-modal-title">Form Review Blueprints</span>
          <button class="btn-modal-close" id="btn-close-dashboard-modal">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="modal-body" id="dashboard-modal-body">
          <div class="modal-item">
            <div class="modal-item-title">1. Squat Depth & Hip Alignment</div>
            <div style="font-size:12px;">Ensure hip crease drops completely below the top of your knee joint. Maintain thoracic spine packing and foot tripod pressure throughout the eccentric phase.</div>
          </div>
          <div class="modal-item">
            <div class="modal-item-title">2. Shoulder Packing & Lat Engagement</div>
            <div style="font-size:12px;">During overhead lifts or pulls, pack your scapula down and in. Visualize pulling your shoulder blades into your back pockets to secure the humerus base.</div>
          </div>
          <div class="modal-item">
            <div class="modal-item-title">3. Core Bracing & Abdominal Pressure</div>
            <div style="font-size:12px;">Do not just suck in your stomach. Breathe diaphragmatically and expand your core laterally 360 degrees to create internal skeletal stability.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render Lucide icons
  lucide.createIcons();

  // --- Draw Dynamic Radar Chart on Sidebar Canvas ---
  const canvas = viewWrap.querySelector('#life-map-canvas-dashboard');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 360 * dpr;
    canvas.height = 360 * dpr;
    ctx.scale(dpr, dpr);

    const cx = 180;
    const cy = 180;
    const maxRadius = 110;
    const dimensions = [
      { key: 'body', label: 'BODY' },
      { key: 'mind', label: 'MIND' },
      { key: 'rest', label: 'REST' },
      { key: 'fuel', label: 'FUEL' },
      { key: 'connection', label: 'CONNECTION' },
      { key: 'purpose', label: 'PURPOSE' }
    ];
    const totalAxes = dimensions.length;
    const angleStep = (Math.PI * 2) / totalAxes;
    const startAngle = -Math.PI / 2;

    let progress = 0;
    const duration = 900;
    const startTime = performance.now();

    function renderRadarFrame(progressVal) {
      ctx.clearRect(0, 0, 360, 360);

      // Concentric rings
      const rings = 5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      for (let r = 1; r <= rings; r++) {
        const radius = (r / rings) * maxRadius;
        ctx.beginPath();
        for (let i = 0; i < totalAxes; i++) {
          const x = cx + Math.cos(startAngle + i * angleStep) * radius;
          const y = cy + Math.sin(startAngle + i * angleStep) * radius;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // Axis lines
      for (let i = 0; i < totalAxes; i++) {
        const angle = startAngle + i * angleStep;
        const xOuter = cx + Math.cos(angle) * maxRadius;
        const yOuter = cy + Math.sin(angle) * maxRadius;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(xOuter, yOuter);
        ctx.stroke();

        // Label texts
        const dim = dimensions[i];
        const labelRadius = maxRadius + 14;
        const labelX = cx + Math.cos(angle) * labelRadius;
        const labelY = cy + Math.sin(angle) * labelRadius;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = "8px 'Outfit', sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(dim.label, labelX, labelY);
      }

      // Draw active data polygon
      const points = [];
      for (let i = 0; i < totalAxes; i++) {
        const dim = dimensions[i];
        const scoreVal = scores[dim.key] || 85;
        const radius = (scoreVal / 100) * maxRadius * progressVal;
        const angle = startAngle + i * angleStep;
        points.push({
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius
        });
      }

      ctx.strokeStyle = 'rgba(99, 102, 241, 0.7)';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
      ctx.beginPath();
      points.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Draw score vertices dot
      points.forEach((pt, idx) => {
        const dim = dimensions[idx];
        const scoreVal = scores[dim.key] || 85;
        const style = getScoreColorStyle(scoreVal);
        ctx.fillStyle = style.hex;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }

    function drawDashboardRadar(time) {
      const elapsed = time - startTime;
      progress = Math.min(1, elapsed / duration);
      renderRadarFrame(progress);
      if (progress < 1) {
        requestAnimationFrame(drawDashboardRadar);
      }
    }
    requestAnimationFrame(drawDashboardRadar);

    window.triggerRadarUpdate = () => {
      renderRadarFrame(1);
    };
  }

  // --- EVENT LISTENERS & WIDGET FUNCTIONALITIES ---

  // Reset retake diagnostic button
  viewWrap.querySelector('#btn-dashboard-reset').addEventListener('click', () => {
    // 1. Explicitly clear all local and session tracking hooks
    localStorage.clear();
    sessionStorage.clear();

    // 2. Clear IndexedDB storage securely
    clearDatabase()
      .then(() => {
        // 3. Force-reset the core wizard progress state context back to starting values
        initializeState();
        state.currentStepIndex = 0;
        state.sessionData = {
          id: 'session_' + Date.now(),
          timestamp: new Date().toISOString(),
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
          generated_roadmap: {},
          dashboard_offers: {}
        };

        // 4. Hard clean unmount of the dashboard container
        const container = document.getElementById('app-container');
        if (container) {
          container.className = 'app-container';
          container.innerHTML = ''; // Clear all dashboard DOM elements instantly
        }

        // 5. Force reload to guarantee a clean starting state
        window.location.reload();
      })
      .catch(err => {
        console.error("Failed to clear DB, resetting in memory:", err);
        
        // Fallback clean unmount and reload sequence
        initializeState();
        state.currentStepIndex = 0;
        
        const container = document.getElementById('app-container');
        if (container) {
          container.className = 'app-container';
          container.innerHTML = '';
        }
        
        window.location.reload();
      });
  });

  // Modal actions
  const modalOverlay = viewWrap.querySelector('#dashboard-modal-overlay');
  const btnCloseModal = viewWrap.querySelector('#btn-close-dashboard-modal');
  
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
    });
  }
  
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) modalOverlay.classList.remove('active');
    });
  }

  // Widget 1: Form Execution Blueprints Button
  const btnFormHelp = viewWrap.querySelector('#btn-show-form-help');
  if (btnFormHelp && modalOverlay) {
    btnFormHelp.addEventListener('click', () => {
      modalOverlay.classList.add('active');
    });
  }

  // Widget 2: Natural Language Quick Nutrition Logging
  const logNutBtn = viewWrap.querySelector('#btn-log-nutrition');
  const nutInput = viewWrap.querySelector('#nutrition-log-input');
  const nutFeed = viewWrap.querySelector('#nutrition-feed-list');
  const pText = viewWrap.querySelector('#protein-progress-text');
  const pBar = viewWrap.querySelector('#protein-progress-bar');
  
  let totalProtein = 32;
  if (logNutBtn && nutInput) {
    logNutBtn.addEventListener('click', () => {
      const val = nutInput.value.trim();
      if (!val) return;
      
      let pEst = 15;
      let kcalEst = 320;
      let name = val;
      
      // Dynamic parsing heuristic
      const lower = val.toLowerCase();
      if (lower.includes("chicken")) {
        pEst = 35;
        kcalEst = 400;
      } else if (lower.includes("egg")) {
        pEst = 18;
        kcalEst = 220;
      } else if (lower.includes("oat") || lower.includes("porridge")) {
        pEst = 10;
        kcalEst = 350;
      } else if (lower.includes("shake") || lower.includes("protein")) {
        pEst = 30;
        kcalEst = 180;
      } else if (lower.includes("beef") || lower.includes("meat")) {
        pEst = 28;
        kcalEst = 380;
      } else if (lower.includes("salad")) {
        pEst = 5;
        kcalEst = 120;
      }

      totalProtein += pEst;
      
      // Update UI
      nutInput.value = '';
      pText.innerText = `${totalProtein}g / 150g`;
      pBar.style.width = `${Math.min(100, (totalProtein / 150) * 100)}%`;
      
      const item = document.createElement('div');
      item.className = 'logged-meal-item';
      item.style.animation = 'fadeIn 0.3s ease';
      item.innerHTML = `
        <span class="logged-meal-text">${name}</span>
        <span>AI Estimate: ${pEst}g Protein | ${kcalEst} kcal</span>
      `;
      nutFeed.insertBefore(item, nutFeed.firstChild);
      
      showNotification(`Logged: +${pEst}g Protein calculated.`);
    });
  }

  // Widget 3: Digital Sunset Screen-Lock Countdown
  const countdownEl = viewWrap.querySelector('#circadian-sunset-countdown');
  if (countdownEl) {
    let hrs = 2;
    let mins = 45;
    let secs = 12;
    
    const countInterval = setInterval(() => {
      if (!viewWrap.querySelector('#circadian-sunset-countdown')) {
        clearInterval(countInterval);
        return;
      }
      
      secs--;
      if (secs < 0) {
        secs = 59;
        mins--;
        if (mins < 0) {
          mins = 59;
          hrs--;
          if (hrs < 0) {
            hrs = 0; mins = 0; secs = 0;
            clearInterval(countInterval);
          }
        }
      }
      
      const hs = hrs.toString().padStart(2, '0');
      const ms = mins.toString().padStart(2, '0');
      const ss = secs.toString().padStart(2, '0');
      countdownEl.innerText = `${hs}h ${ms}m ${ss}s`;
    }, 1000);
  }

  // Widget 4: Pomodoro & Study Vault
  const pTime = viewWrap.querySelector('#pomodoro-time');
  const pToggle = viewWrap.querySelector('#btn-pomodoro-toggle');
  const pReset = viewWrap.querySelector('#btn-pomodoro-reset');
  const pTxt = viewWrap.querySelector('#pomodoro-toggle-txt');
  const pIcon = viewWrap.querySelector('#pomodoro-icon');
  
  let pMins = 25;
  let pSecs = 0;
  let pInterval = null;
  let pRunning = false;
  
  if (pToggle && pReset) {
    pToggle.addEventListener('click', () => {
      pRunning = !pRunning;
      if (pRunning) {
        pToggle.classList.add('active-play');
        pTxt.innerText = 'Pause Focus';
        pIcon.setAttribute('data-lucide', 'pause');
        lucide.createIcons();
        
        pInterval = setInterval(() => {
          if (!viewWrap.querySelector('#pomodoro-time')) {
            clearInterval(pInterval);
            return;
          }
          pSecs--;
          if (pSecs < 0) {
            pSecs = 59;
            pMins--;
            if (pMins < 0) {
              clearInterval(pInterval);
              pRunning = false;
              pMins = 25; pSecs = 0;
              pToggle.classList.remove('active-play');
              pTxt.innerText = 'Start Session';
              pIcon.setAttribute('data-lucide', 'play');
              lucide.createIcons();
              showNotification("Focus session complete! Rest 5m.");
            }
          }
          const ms = pMins.toString().padStart(2, '0');
          const ss = pSecs.toString().padStart(2, '0');
          pTime.innerText = `${ms}:${ss}`;
        }, 1000);
      } else {
        clearInterval(pInterval);
        pToggle.classList.remove('active-play');
        pTxt.innerText = 'Resume Focus';
        pIcon.setAttribute('data-lucide', 'play');
        lucide.createIcons();
      }
    });
    
    pReset.addEventListener('click', () => {
      clearInterval(pInterval);
      pRunning = false;
      pMins = 25; pSecs = 0;
      pTime.innerText = '25:00';
      pToggle.classList.remove('active-play');
      pTxt.innerText = 'Start Session';
      pIcon.setAttribute('data-lucide', 'play');
      lucide.createIcons();
    });
  }

  // Active task prioritization list
  const btnAddTask = viewWrap.querySelector('#btn-add-task');
  const taskField = viewWrap.querySelector('#task-input-field');
  const tasksFeed = viewWrap.querySelector('#tasks-list-container');
  
  if (btnAddTask && taskField && tasksFeed) {
    btnAddTask.addEventListener('click', () => {
      const val = taskField.value.trim();
      if (!val) return;
      
      const item = document.createElement('div');
      item.className = 'task-item-card';
      item.style.animation = 'fadeIn 0.3s ease';
      item.innerHTML = `
        <div class="task-item-left">
          <div class="task-checkbox"><i data-lucide="check"></i></div>
          <span class="task-text">${val}</span>
        </div>
        <button class="btn-task-delete"><i data-lucide="trash-2"></i></button>
      `;
      tasksFeed.appendChild(item);
      taskField.value = '';
      lucide.createIcons();
      
      // Bind checkbox toggles
      const chk = item.querySelector('.task-checkbox');
      chk.addEventListener('click', () => {
        chk.classList.toggle('checked');
        const txt = item.querySelector('.task-text');
        txt.classList.toggle('completed');
        item.classList.toggle('completed');
        
        if (chk.classList.contains('checked')) {
          showNotification("Task priority cleared.");
        }
      });
      
      // Bind delete button
      item.querySelector('.btn-task-delete').addEventListener('click', () => {
        item.remove();
      });
    });
    
    // Bind initial pre-existing task item
    const preChk = tasksFeed.querySelector('.task-checkbox');
    if (preChk) {
      preChk.addEventListener('click', () => {
        preChk.classList.toggle('checked');
        const item = tasksFeed.querySelector('.task-item-card');
        const txt = item.querySelector('.task-text');
        txt.classList.toggle('completed');
        item.classList.toggle('completed');
        if (preChk.classList.contains('checked')) {
          showNotification("Task priority cleared.");
        }
      });
      tasksFeed.querySelector('.btn-task-delete').addEventListener('click', () => {
        tasksFeed.querySelector('.task-item-card').remove();
      });
    }
  }

  // Widget 5: Cognitive Synthesis Morning Brain Dump
  const btnSynth = viewWrap.querySelector('#btn-synthesize-clarity');
  const dumpField = viewWrap.querySelector('#mental-brain-dump-input');
  const synthContainer = viewWrap.querySelector('#synthesized-clarity-container');
  const synthList = viewWrap.querySelector('#synthesized-clarity-list');
  
  if (btnSynth && dumpField && synthContainer) {
    btnSynth.addEventListener('click', () => {
      const val = dumpField.value.trim();
      if (!val) return;
      
      btnSynth.innerHTML = `<div class="spinner-ring" style="width:16px; height:16px; border-width:2px; margin-right:6px;"></div><span>Extracting focus vectors...</span>`;
      btnSynth.setAttribute('disabled', 'true');
      
      setTimeout(() => {
        btnSynth.innerHTML = `<i data-lucide="brain"></i><span>Synthesize Clarity Matrix</span>`;
        btnSynth.removeAttribute('disabled');
        lucide.createIcons();
        
        // Generate dynamic lists based on what they type
        let priorities = [
          "Focus on immediate actions rather than planning loops.",
          "Identify and secure digital boundaries. Screen off by 9:30 PM.",
          "Divide and isolate large focus tasks to secure cognitive capacity."
        ];
        
        const lower = val.toLowerCase();
        if (lower.includes("exam") || lower.includes("study") || lower.includes("work")) {
          priorities = [
            "Block out exactly 2 focus blocks of 50 minutes for heavy revision/work.",
            "De-clutter tabs and use the digital vault Pomodoro timer exclusively.",
            "Take 10 minutes offline breaks in between sessions to recover cognitive energy."
          ];
        } else if (lower.includes("tired") || lower.includes("sleep") || lower.includes("exhaust")) {
          priorities = [
            "Initiate an early circadian sunset wind-down boundary. No phone in bed.",
            "Establish direct morning sunlight access (10 mins) right after waking up.",
            "Hydrate heavily and drop caffeine intake after 1:00 PM."
          ];
        }
        
        synthList.innerHTML = priorities.map((p, idx) => `
          <div>${idx + 1}. ${p}</div>
        `).join('');
        
        synthContainer.style.display = 'flex';
        dumpField.value = '';
        showNotification("Thought clutter structured.");
      }, 1200);
    });
  }

  // Somatic Respiration breathing timer
  const breathingBtn = viewWrap.querySelector('#btn-breathing-toggle');
  const breathingCircle = viewWrap.querySelector('#breathing-glow-node');
  const breathingPhaseTxt = viewWrap.querySelector('#breathing-phase-txt');
  
  let breathingActive = false;
  let breathingInterval = null;
  let breathingPhase = 0; // 0: Inhale, 1: Hold, 2: Exhale, 3: Hold
  
  if (breathingBtn && breathingCircle) {
    breathingBtn.addEventListener('click', () => {
      breathingActive = !breathingActive;
      if (breathingActive) {
        breathingBtn.innerText = 'Stop';
        breathingBtn.style.background = 'rgba(255, 69, 58, 0.15)';
        breathingBtn.style.color = '#ff453a';
        breathingBtn.style.borderColor = 'rgba(255, 69, 58, 0.3)';
        
        breathingPhase = 0;
        breathingCircle.className = 'breathing-circle-glow inhale';
        breathingPhaseTxt.innerText = 'Inhale deeply... (4s)';
        
        breathingInterval = setInterval(() => {
          breathingPhase = (breathingPhase + 1) % 4;
          if (breathingPhase === 0) {
            breathingCircle.className = 'breathing-circle-glow inhale';
            breathingPhaseTxt.innerText = 'Inhale deeply... (4s)';
          } else if (breathingPhase === 1) {
            breathingCircle.className = 'breathing-circle-glow hold';
            breathingPhaseTxt.innerText = 'Hold the breath... (4s)';
          } else if (breathingPhase === 2) {
            breathingCircle.className = 'breathing-circle-glow exhale';
            breathingPhaseTxt.innerText = 'Exhale fully... (4s)';
          } else if (breathingPhase === 3) {
            breathingCircle.className = 'breathing-circle-glow hold';
            breathingPhaseTxt.innerText = 'Hold empty... (4s)';
          }
        }, 4000);
      } else {
        clearInterval(breathingInterval);
        breathingBtn.innerText = 'Start';
        breathingBtn.style.background = '';
        breathingBtn.style.color = '';
        breathingBtn.style.borderColor = '';
        breathingCircle.className = 'breathing-circle-glow';
        breathingPhaseTxt.innerText = 'Tap start to begin physiological down-regulation';
      }
    });
  }

  // Widget 6: Inner Circle reminder click logs & battery stamina cells
  const checkinBtns = viewWrap.querySelectorAll('.btn-bond-checkin[data-bond]');
  checkinBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.getAttribute('data-bond');
      const fill = viewWrap.querySelector(`#fill-bond-${idx}`);
      const badge = viewWrap.querySelector(`#badge-bond-${idx}`);
      
      if (fill && badge) {
        fill.style.width = '100%';
        badge.innerText = 'Synchronized';
        badge.className = 'bond-due-badge checked-in';
        showNotification("Check-in logged. Bonds secured.");
      }
    });
  });

  // Battery stamina cells click behaviors
  const segments = viewWrap.querySelectorAll('.social-battery-segment');
  segments.forEach(seg => {
    seg.addEventListener('click', () => {
      const targetIdx = parseInt(seg.getAttribute('data-idx'));
      segments.forEach((s, idx) => {
        if (idx <= targetIdx) {
          s.classList.add('active');
        } else {
          s.classList.remove('active');
        }
      });
      showNotification(`Battery adjusted: ${targetIdx + 1}/5 cells.`);
    });
  });

  // --- Tracking Matrix Checklist Bindings ---
  const trackingCheckboxes = viewWrap.querySelectorAll('.tracking-chk');
  trackingCheckboxes.forEach(chk => {
    chk.addEventListener('click', () => {
      chk.classList.toggle('checked');
      const item = chk.closest('.task-item-card');
      const txt = item.querySelector('.task-text');
      txt.classList.toggle('completed');
      item.classList.toggle('completed');
      
      const dim = item.getAttribute('data-dim');
      const isDaily = item.classList.contains('daily-track-item');
      
      // Calculate delta to add/remove live
      const delta = chk.classList.contains('checked') ? (isDaily ? 5 : 10) : (isDaily ? -5 : -10);
      
      // Apply delta directly to local scores copy
      scores[dim] = Math.min(100, Math.max(15, (scores[dim] || 85) + delta));
      
      // Update HTML text representation on the sidebar
      const sidebarItems = Array.from(viewWrap.querySelectorAll('.lifemap-dimension-item'));
      const targetItem = sidebarItems.find(el => el.innerHTML.toUpperCase().includes(dim.toUpperCase()));
      if (targetItem) {
        const sidebarScoreEl = targetItem.querySelector('.lifemap-dim-score');
        if (sidebarScoreEl) {
          const scoreVal = Math.round(scores[dim]);
          const styleInfo = getScoreColorStyle(scoreVal);
          
          sidebarScoreEl.className = `lifemap-dim-score ${styleInfo.cls}`;
          sidebarScoreEl.style.color = styleInfo.hex;
          sidebarScoreEl.innerHTML = `${scoreVal}<span class="score-denominator" style="font-size:9px;">/100</span>`;
          
          // Also update icon box color for premium visual synchronization
          const iconBox = targetItem.querySelector('.lifemap-dim-icon-box');
          if (iconBox) {
            iconBox.style.color = styleInfo.hex;
            iconBox.style.borderColor = `rgba(${hexToRgb(styleInfo.hex)}, 0.18)`;
            iconBox.style.background = `rgba(${hexToRgb(styleInfo.hex)}, 0.04)`;
          }
        }
      }
      
      // Redraw canvas radar chart in real-time
      if (window.triggerRadarUpdate) {
        window.triggerRadarUpdate();
      }
      
      if (chk.classList.contains('checked')) {
        showNotification(`Macro growth synced: +${isDaily ? 5 : 10}% ${dim.toUpperCase()} progress.`);
      }
    });
  });
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
