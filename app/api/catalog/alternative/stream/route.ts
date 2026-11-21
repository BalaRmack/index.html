import { NextResponse } from 'next/server';
import { alternativeStream, validExternalId, type AlternativeSource } from '@/lib/alternatives';
export const dynamic='force-dynamic';
export async function GET(req:Request) {
  const p=new URL(req.url).searchParams,source=p.get('source')||'',id=p.get('id')||'';
  if(!validExternalId(source,id))return NextResponse.json({error:'Некорректный трек.'},{status:400});
  try{return NextResponse.json({url:await alternativeStream(source as AlternativeSource,id)},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Аудио недоступно у этого источника.'},{status:503});}
}
