import Image from "next/image";
import Link from "next/link";

const navLinks = [
  { href: "/", label: "Live Arena" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/agents", label: "Create Agent" },
  { href: "/tables", label: "Tables" },
];

const socials = [
  {
    label: "Discord",
    href: "#",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.545 2.907a13.227 13.227 0 00-3.257-1.011.05.05 0 00-.052.025c-.141.25-.297.577-.406.833a12.19 12.19 0 00-3.658 0 8.258 8.258 0 00-.412-.833.051.051 0 00-.052-.025c-1.125.194-2.22.534-3.257 1.011a.046.046 0 00-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.276 13.276 0 003.995 2.02.05.05 0 00.056-.019c.308-.42.582-.863.818-1.329a.05.05 0 00-.028-.07 8.735 8.735 0 01-1.248-.595.05.05 0 01-.005-.083c.084-.063.168-.129.248-.195a.049.049 0 01.051-.007c2.619 1.196 5.454 1.196 8.041 0a.048.048 0 01.053.007c.08.066.164.132.248.195a.05.05 0 01-.004.083c-.399.233-.813.44-1.249.595a.05.05 0 00-.027.07c.24.466.514.909.817 1.329a.05.05 0 00.056.019 13.235 13.235 0 004.001-2.02.049.049 0 00.021-.037c.334-3.451-.559-6.449-2.366-9.106a.034.034 0 00-.02-.019z" />
      </svg>
    ),
  },
  {
    label: "Twitter",
    href: "#",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75zm-.86 13.028h1.36L4.323 2.145H2.865l8.875 11.633z" />
      </svg>
    ),
  },
  {
    label: "Telegram",
    href: "#",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M16 8A8 8 0 110 8a8 8 0 0116 0zM8.287 5.906c-.778.324-2.334.994-4.666 2.01-.378.15-.577.298-.595.442-.03.243.275.339.69.47l.175.055c.408.133.958.288 1.243.294.26.006.549-.1.868-.32 2.179-1.471 3.304-2.214 3.374-2.23.05-.012.12-.027.166.016.047.043.042.126.037.148-.03.14-1.225 1.244-1.838 1.825-.19.18-.325.307-.353.336-.063.06-.128.118-.19.175.467.353.898.68 1.102.862.47.418 1.004.822 1.562.698.244-.054.496-.4.626-1.49.308-2.582.927-4.474 1.055-5.198.028-.167.046-.267.048-.356a.387.387 0 00-.014-.108.108.108 0 00-.066-.073c-.054-.019-.16-.039-.226-.02-.366.102-2.137 1.31-3.996 2.464z" />
      </svg>
    ),
  },
  {
    label: "GitHub",
    href: "#",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    ),
  },
];

export default function Footer() {
  return (
    <footer className="relative pt-11 pb-6 px-5 lg:pt-[6.5rem] lg:px-7.5 lg:pb-12 xl:px-10">
      {/* Top section: logo + nav */}
      <div className="flex flex-col items-center lg:flex-row lg:items-center h-auto lg:h-[6.5rem] mb-6 border-b border-neutral-500 pb-6 lg:pb-0 max-w-[77.5rem] mx-auto">
        <Link href="/" className="block mb-6 lg:mb-0">
          <span className="flex items-center gap-2">
            <Image src="/icon.png" alt="logo" width={48} height={48} />
            <span className="text-3xl font-bold text-forground font-grotesk">AgentPoker</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center justify-center lg:ml-auto">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-6 py-4 lg:px-12 lg:py-8 text-xs font-semibold leading-5 uppercase tracking-wider text-neutral-300 transition-colors hover:text-neutral-50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Bottom section: copyright + socials */}
      <div className="lg:flex lg:items-center lg:justify-between max-w-[77.5rem] mx-auto">
        <p className="hidden text-sm text-neutral-300 lg:block">
          &copy; {new Date().getFullYear()} AgentPoker
        </p>

        <div className="flex justify-center -mx-4">
          {socials.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={social.label}
              className="flex items-center justify-center w-10 h-10 mx-4 rounded-full bg-neutral-500/50 text-neutral-300 transition-colors hover:bg-neutral-500 hover:text-neutral-50"
            >
              {social.icon}
            </a>
          ))}
        </div>
      </div>

      {/* Decorative vertical lines */}
      <div className="hidden absolute top-0 left-5 w-px h-full bg-neutral-500 pointer-events-none md:block lg:left-7.5 xl:left-10" />
      <div className="hidden absolute top-0 right-5 w-px h-full bg-neutral-500 pointer-events-none md:block lg:right-7.5 xl:right-10" />

      {/* Decorative horizontal line */}
      <div className="hidden absolute top-0 left-7.5 right-7.5 h-px bg-neutral-500 pointer-events-none lg:block xl:left-10 xl:right-10" />
    </footer>
  );
}
