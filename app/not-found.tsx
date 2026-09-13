import Link from "next/link";

export default function NotFound() {
  return <main className="notFound">
    <p className="eyebrow">404 &middot; TITIK BUTA</p>
    <h1>Halaman tidak ditemukan.</h1>
    <p>Screener cuma punya: beranda, ranking, reverse replay, original replay, login.</p>
    <nav aria-label="Halaman tersedia">
      <ul>
        <li><Link href="/">Beranda</Link></li>
        <li><Link href="/ranking">Ranking</Link></li>
        <li><Link href="/reverse">Reverse replay</Link></li>
        <li><Link href="/original">Original replay</Link></li>
        <li><Link href="/login">Login</Link></li>
      </ul>
    </nav>
  </main>;
}
