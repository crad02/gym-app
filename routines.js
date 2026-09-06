"use strict";
/* ---------- Starter routines ---------- */
// Authored templates, offered on the Home screen to anyone who hasn't built
// their own yet. Exercises are referenced by NAME, not id: exIds are minted
// per-device, so a template has to resolve through ensureExercise() at the
// moment it's adopted. The muscle is carried alongside so that resolution
// doesn't depend on the exercise already existing in the user's library.
//
// `sets` and `reps` are a starting target, used only until there's real history
// — once you've done a lift, ghost sets seed from what you actually lifted.
//
// Keeping these deliberately short. A template that lists twelve exercises
// reads like homework; these are the shape of a session, not a prescription.
const STARTER_ROUTINES = [
  {
    slug: "ppl-push",
    name: "Push A",
    tag: "Push · Pull · Legs",
    blurb: "Chest and shoulders, heaviest press first.",
    exercises: [
      { name:"Bench Press",           muscle:"Chest",     sets:4, reps:6  },
      { name:"Overhead Press",        muscle:"Shoulders", sets:3, reps:8  },
      { name:"Incline Dumbbell Press",muscle:"Chest",     sets:3, reps:10 },
      { name:"Lateral Raise",         muscle:"Shoulders", sets:3, reps:15 },
      { name:"Triceps Pushdown",      muscle:"Triceps",   sets:3, reps:12 },
    ],
  },
  {
    slug: "ppl-pull",
    name: "Pull A",
    tag: "Push · Pull · Legs",
    blurb: "A row and a vertical pull, then arms.",
    exercises: [
      { name:"Barbell Row",   muscle:"Back",    sets:4, reps:8  },
      { name:"Lat Pulldown",  muscle:"Back",    sets:3, reps:10 },
      { name:"Face Pull",     muscle:"Back",    sets:3, reps:15 },
      { name:"Barbell Curl",  muscle:"Biceps",  sets:3, reps:10 },
      { name:"Hammer Curl",   muscle:"Biceps",  sets:3, reps:12 },
    ],
  },
  {
    slug: "ppl-legs",
    name: "Legs A",
    tag: "Push · Pull · Legs",
    blurb: "Squat, hinge, and the bits everyone skips.",
    exercises: [
      { name:"Squat",           muscle:"Quads",      sets:4, reps:6  },
      { name:"Romanian Deadlift",muscle:"Hamstrings",sets:3, reps:8  },
      { name:"Leg Press",       muscle:"Quads",      sets:3, reps:12 },
      { name:"Leg Curl",        muscle:"Hamstrings", sets:3, reps:12 },
      { name:"Calf Raise",      muscle:"Calves",     sets:4, reps:15 },
    ],
  },
  {
    slug: "ul-upper",
    name: "Upper",
    tag: "Upper / Lower",
    blurb: "Push and pull in one session, balanced.",
    exercises: [
      { name:"Bench Press",    muscle:"Chest",     sets:4, reps:6  },
      { name:"Barbell Row",    muscle:"Back",      sets:4, reps:8  },
      { name:"Overhead Press", muscle:"Shoulders", sets:3, reps:8  },
      { name:"Lat Pulldown",   muscle:"Back",      sets:3, reps:10 },
      { name:"Barbell Curl",   muscle:"Biceps",    sets:3, reps:10 },
    ],
  },
  {
    slug: "ul-lower",
    name: "Lower",
    tag: "Upper / Lower",
    blurb: "Squat and hinge, plus accessories.",
    exercises: [
      { name:"Squat",            muscle:"Quads",      sets:4, reps:6  },
      { name:"Romanian Deadlift",muscle:"Hamstrings", sets:3, reps:8  },
      { name:"Leg Press",        muscle:"Quads",      sets:3, reps:12 },
      { name:"Calf Raise",       muscle:"Calves",     sets:4, reps:15 },
    ],
  },
  {
    slug: "full-body",
    name: "Full Body",
    tag: "Three days a week",
    blurb: "One squat, one press, one pull. That's the whole session.",
    exercises: [
      { name:"Squat",          muscle:"Quads",     sets:3, reps:5 },
      { name:"Bench Press",    muscle:"Chest",     sets:3, reps:5 },
      { name:"Barbell Row",    muscle:"Back",      sets:3, reps:8 },
      { name:"Overhead Press", muscle:"Shoulders", sets:3, reps:8 },
    ],
  },
];
