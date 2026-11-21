import { NextResponse } from 'next/server';
import { isVideoId, resolveStream } from '@/lib/catalog';
export const dynamic = 'force-dynamic';
export async function GET(req:Request) {
  const p=new URL(req.url).searchParams; const id=p.get('id') || '';
  if(!isVideoId(id)) return NextResponse.json({error:'Некорректный идентификатор трека.'},{status:400});
  const exclude=(p.get('exclude') || '').split(',').slice(0,6);
  try { const {value,mirror}=await resolveStream(id,exclude); return NextResponse.json({...value,mirror},{headers:{'Cache-Control':'no-store'}}); }
  catch { return NextResponse.json({error:'Нет доступных потоков на зеркалах.'},{status:503}); }
}
