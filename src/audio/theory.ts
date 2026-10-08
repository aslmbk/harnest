/**
 * Tiny music-theory toolkit for the generative score: modes, diatonic chords, voice leading and a
 * Markov-style chord walk. Pure functions — unit tested in tests/audio-theory.test.ts.
 */
import type { Rng } from './rng';

export type ModeName = 'ionian' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'aeolian';

export const MODES: Record<ModeName, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};

/** One step brighter on the same root (raises one scale degree). Used after the gate opens. */
export const BRIGHTER: Record<ModeName, ModeName> = {
  phrygian: 'aeolian',
  aeolian: 'dorian',
  dorian: 'mixolydian',
  mixolydian: 'ionian',
  ionian: 'lydian',
  lydian: 'lydian',
};

export type ChordColor = 'triad' | 'seventh' | 'add9' | 'sus2' | 'sus4' | 'open5';

/** Chord shapes as scale-degree offsets from the chord root. */
export const CHORD_SHAPES: Record<ChordColor, readonly number[]> = {
  triad: [0, 2, 4],
  seventh: [0, 2, 4, 6],
  add9: [0, 2, 4, 8],
  sus2: [0, 1, 4],
  sus4: [0, 3, 4],
  open5: [0, 4, 7],
};

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

/** MIDI note of a scale degree. Degrees below 0 or above 6 wrap into other octaves. */
export function degreeToMidi(root: number, mode: ModeName, degree: number): number {
  const steps = MODES[mode];
  const octave = Math.floor(degree / 7);
  const index = ((degree % 7) + 7) % 7;
  return root + octave * 12 + steps[index];
}

export type TriadQuality = 'major' | 'minor' | 'diminished' | 'augmented';

export function triadQuality(mode: ModeName, degree: number): TriadQuality {
  const r = degreeToMidi(0, mode, degree);
  const third = degreeToMidi(0, mode, degree + 2) - r;
  const fifth = degreeToMidi(0, mode, degree + 4) - r;
  if (fifth === 6) return 'diminished';
  if (fifth === 8) return 'augmented';
  return third === 4 ? 'major' : 'minor';
}

/** Absolute pitch classes (0..11) of a chord built on a scale degree. */
export function chordPitchClasses(root: number, mode: ModeName, degree: number, color: ChordColor): number[] {
  const out: number[] = [];
  for (const off of CHORD_SHAPES[color]) {
    const pc = pitchClass(degreeToMidi(root, mode, degree + off));
    if (!out.includes(pc)) out.push(pc);
  }
  return out;
}

/** Absolute pitch classes of the scale. */
export function scalePitchClasses(root: number, mode: ModeName): number[] {
  return MODES[mode].map((step) => pitchClass(root + step));
}

/**
 * Moves `midi` by `steps` scale degrees inside [low, high] (snapping to the scale first).
 * Clamps at the range edges.
 */
export function scaleStep(midi: number, steps: number, root: number, mode: ModeName, low: number, high: number): number {
  const scale = notesInRange(scalePitchClasses(root, mode), low, high);
  if (!scale.length) return midi;
  let idx = 0;
  for (let i = 1; i < scale.length; i++) if (Math.abs(scale[i] - midi) < Math.abs(scale[idx] - midi)) idx = i;
  return scale[Math.max(0, Math.min(scale.length - 1, idx + steps))];
}

/** Every MIDI note in [low, high] whose pitch class is in `pcs`, ascending. */
export function notesInRange(pcs: readonly number[], low: number, high: number): number[] {
  const out: number[] = [];
  for (let m = Math.ceil(low); m <= high; m++) if (pcs.includes(pitchClass(m))) out.push(m);
  return out;
}

/**
 * Places each pitch class in [low, high] as close as possible to the previous voicing (smooth voice
 * leading, common tones kept). Without a previous voicing: close position from the bottom third of the
 * range. Returns the notes ascending, one per pitch class.
 */
export function voiceChord(pcs: readonly number[], prev: readonly number[] | null, low: number, high: number): number[] {
  const anchor = prev && prev.length ? prev : null;
  const centre = anchor ? anchor.reduce((a, b) => a + b, 0) / anchor.length : low + (high - low) * 0.35;
  const out: number[] = [];
  for (const pc of pcs) {
    let best = NaN;
    let bestCost = Infinity;
    for (let m = Math.ceil(low); m <= high; m++) {
      if (pitchClass(m) !== pc || out.includes(m)) continue;
      // Distance to the nearest previous voice, with a light pull toward the centre of the voicing.
      let cost = Math.abs(m - centre) * 0.35;
      if (anchor) {
        let near = Infinity;
        for (const p of anchor) near = Math.min(near, Math.abs(m - p));
        cost += near;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = m;
      }
    }
    if (!Number.isNaN(best)) out.push(best);
  }
  return out.sort((a, b) => a - b);
}

/** Degrees whose triad is usable as a pad chord (no diminished / augmented). */
export function usableDegrees(mode: ModeName): number[] {
  const out: number[] = [];
  for (let d = 0; d < 7; d++) {
    const q = triadQuality(mode, d);
    if (q === 'major' || q === 'minor') out.push(d);
  }
  return out;
}

/**
 * Next chord degree: a weighted walk that prefers fourths/fifths and steps, never repeats the current
 * chord, and is pulled home to the tonic the longer it has been away.
 */
export function nextDegree(rng: Rng, mode: ModeName, current: number, sinceTonic: number): number {
  const options = usableDegrees(mode).filter((d) => d !== current);
  const weights = options.map((d) => {
    const up = (((d - current) % 7) + 7) % 7; // 1..6 scale steps upward
    let w = up === 3 || up === 4 ? 3 : up === 1 || up === 6 ? 2 : 1.4;
    if (d === 0) w += sinceTonic;
    if (d === 6 && mode !== 'aeolian' && mode !== 'dorian' && mode !== 'mixolydian') w *= 0.5;
    return w;
  });
  return options[rng.weighted(weights)];
}

/** Lush but calm chord colours, weighted toward add9 / sevenths. */
export function pickColor(rng: Rng): ChordColor {
  const colors: ChordColor[] = ['add9', 'seventh', 'triad', 'sus2', 'sus4', 'open5'];
  return colors[rng.weighted([5, 3, 1.5, 1, 0.7, 1])];
}
