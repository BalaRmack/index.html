export type ListeningState = {seconds:number;last:number;completed:boolean;started:boolean};
/** Counts contiguous media playback only, not seeks or pauses. */
export function advanceListening(state:ListeningState,time:number,duration:number,playing:boolean,seeking:boolean) {
  const delta=time-state.last;
  if(playing && !seeking && delta>0 && delta<2.5) state.seconds+=delta;
  state.last=time;
  if(!state.completed && Number.isFinite(duration) && duration>0 && state.seconds/duration>0.7) {state.completed=true;return true;}
  return false;
}
export function shouldRecordSkip(state:ListeningState) {return state.started && !state.completed && state.seconds<10;}
