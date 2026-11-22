import { NextResponse } from 'next/server';
import { searchCatalog } from '@/lib/catalog';
export const dynamic = 'force-dynamic';
export async function GET(req:Request) {
  const query = new URL(req.url).searchParams.get('q')?.trim() || '';
  if(query.length < 2 || query.length > 120) return NextResponse.json({error:'Введите от 2 до 120 символов.'},{status:400});
  try { const {value,mirror} = await searchCatalog(query); return NextResponse.json({tracks:value,mirror},{headers:{'Cache-Control':'public, s-maxage=300, stale-while-revalidate=600'}}); }
  catch { return NextResponse.json({error:'Каталог временно недоступен. Попробуйте позже.'},{status:503}); }
}
