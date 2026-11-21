import { NextResponse } from 'next/server';
import { searchAlternative, type AlternativeSource } from '@/lib/alternatives';
export const dynamic='force-dynamic';
export async function GET(req:Request) {
  const p=new URL(req.url).searchParams,q=(p.get('q')||'').trim(),source=p.get('source');
  if(q.length<2||q.length>120||!['deezer','jiosaavn'].includes(source||''))return NextResponse.json({error:'Некорректный запрос.'},{status:400});
  try {return NextResponse.json({tracks:await searchAlternative(source as AlternativeSource,q)});}
  catch{return NextResponse.json({error:`${source==='deezer'?'Deezer':'JioSaavn'} временно недоступен.`},{status:503});}
}
