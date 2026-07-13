import { Card } from "@lumen-media/module-sdk/ui";
import { t } from "./i18n.js";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Wheel } from "react-custom-roulette";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const rand = () => ALPHABET[Math.floor(Math.random() * 26)];

const DEFAULT_WHEEL_COLORS = ["#36c5f0", "#2aa8d8", "#57d6f6", "#168bb7", "#8be5fb"];

const FACES = 4;
const FACE_DEG = 360 / FACES;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface HslColor {
  h: number;
  s: number;
  l: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function linearToSrgb(value: number) {
  return value >= 0.0031308
    ? 1.055 * Math.pow(value, 1 / 2.4) - 0.055
    : 12.92 * value;
}

function oklchToRgb(l: number, c: number, h: number): RgbColor {
  const hue = (h * Math.PI) / 180;
  const a = Math.cos(hue) * c;
  const b = Math.sin(hue) * c;

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = lPrime ** 3;
  const m3 = mPrime ** 3;
  const s3 = sPrime ** 3;

  return {
    r: Math.round(clamp(linearToSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3), 0, 1) * 255),
    g: Math.round(clamp(linearToSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3), 0, 1) * 255),
    b: Math.round(clamp(linearToSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3), 0, 1) * 255),
  };
}

function parseOklch(color: string): RgbColor | null {
  const match = color.match(/oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)/i);
  if (!match) return null;

  const l = match[1].endsWith("%") ? Number.parseFloat(match[1]) / 100 : Number.parseFloat(match[1]);
  const c = match[2].endsWith("%") ? Number.parseFloat(match[2]) / 100 : Number.parseFloat(match[2]);
  const h = Number.parseFloat(match[3]);

  if (![l, c, h].every(Number.isFinite)) return null;
  return oklchToRgb(l, c, h);
}

function parseRgb(color: string): RgbColor | null {
  const match = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!match) return null;

  return {
    r: clamp(Math.round(Number.parseFloat(match[1])), 0, 255),
    g: clamp(Math.round(Number.parseFloat(match[2])), 0, 255),
    b: clamp(Math.round(Number.parseFloat(match[3])), 0, 255),
  };
}

function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const r1 = r / 255;
  const g1 = g / 255;
  const b1 = b / 255;
  const max = Math.max(r1, g1, b1);
  const min = Math.min(r1, g1, b1);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  const h = max === r1
    ? 60 * (((g1 - b1) / delta) % 6)
    : max === g1
      ? 60 * ((b1 - r1) / delta + 2)
      : 60 * ((r1 - g1) / delta + 4);

  return { h: (h + 360) % 360, s, l };
}

function hslToRgb({ h, s, l }: HslColor): RgbColor {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x];

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function rgbToHex({ r, g, b }: RgbColor) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function getCssVariableColor(name: string): RgbColor | null {
  if (typeof document === "undefined") return null;

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = parseOklch(value) ?? parseRgb(value);
  if (parsed) return parsed;

  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const normalized = getComputedStyle(probe).color;
  probe.remove();

  return parseRgb(normalized);
}

function createWheelPalette(primary: RgbColor | null) {
  if (!primary) return DEFAULT_WHEEL_COLORS;

  const base = rgbToHsl(primary);
  const offsets = [0, 18, -18, 36, -36, 54, -54, 72];
  return offsets.map((offset, index) => rgbToHex(hslToRgb({
    h: (base.h + offset + 360) % 360,
    s: clamp(base.s * (index % 2 === 0 ? 1 : 0.86), 0.45, 0.9),
    l: clamp(base.l + (index % 3 - 1) * 0.08, 0.32, 0.68),
  })));
}

function getContrastText({ r, g, b }: RgbColor) {
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.58 ? "#07111f" : "#ffffff";
}


interface TileProps {
  char: string;
  index: number;
  onDone: () => void;
  duration: number;
  fontSize: number;
}

function LetterTile({ char, index, onDone, duration, fontSize }: TileProps) {
  const tileW = Math.round(fontSize * 1.4);
  const tileH = Math.round(fontSize * 1.8);
  const radius = Math.round(tileH / 2);
  const perspective = tileH * 3;
  const [faceLetters, setFaceLetters] = useState<string[]>(() =>
    Array.from({ length: FACES }, rand)
  );
  const [isDone, setIsDone] = useState(false);
  const drumRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    setIsDone(false);
    setFaceLetters(Array.from({ length: FACES }, rand));

    const drum = drumRef.current;
    if (!drum) return;

    const stagger = index * 90;
    const fullSpins = 4 + Math.floor(Math.random() * 3);
    const totalDeg = fullSpins * 360;

    const anim = drum.animate(
      [{ transform: "rotateX(0deg)" }, { transform: `rotateX(${totalDeg}deg)` }],
      { duration, delay: stagger, easing: "cubic-bezier(0.2, 0, 0.1, 1)", fill: "forwards" }
    );

    const startTime = performance.now() + stagger;
    let lastFace = -1;

    const updateLetters = (now: number) => {
      if (doneRef.current) return;
      const elapsed = now - startTime;
      if (elapsed < 0) { rafRef.current = requestAnimationFrame(updateLetters); return; }
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const deg = eased * totalDeg;
      const faceNow = Math.floor(deg / FACE_DEG) % FACES;
      if (faceNow !== lastFace) {
        lastFace = faceNow;
        setFaceLetters(prev => {
          const next = [...prev];
          next[(faceNow + Math.floor(FACES / 2)) % FACES] = rand();
          return next;
        });
      }
      if (t < 1) rafRef.current = requestAnimationFrame(updateLetters);
    };

    rafRef.current = requestAnimationFrame(updateLetters);

    anim.addEventListener("finish", () => {
      if (doneRef.current) return;
      doneRef.current = true;
      cancelAnimationFrame(rafRef.current);
      setFaceLetters(prev => {
        const next = [...prev];
        next[0] = char.toUpperCase();
        return next;
      });
      setIsDone(true);
      onDone();
    });

    return () => {
      doneRef.current = true;
      cancelAnimationFrame(rafRef.current);
      anim.cancel();
    };
  }, [char, index, duration]);

  return (
    <div style={{ width: tileW, height: tileH, perspective }}>
      <div
        ref={drumRef}
        className="w-full h-full relative transform-3d"
        style={{ transform: isDone ? "rotateX(0deg)" : undefined }}
      >
        {faceLetters.map((letter, fi) => (
          <div
            key={fi}
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-[oklch(17%_0.035_265)] border border-white/[0.07]"
            style={{
              backfaceVisibility: "hidden",
              transform: `rotateX(${-fi * FACE_DEG}deg) translateZ(${radius}px)`,
            }}
          >
            <span style={{ fontSize, fontWeight: 800, lineHeight: 1, color: "white" }}>
              {letter}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PICKER_REPEATS = 8;

interface NamePickerProps {
  names: string[];
  prizeIndex: number;
  animationKey: number;
  duration: number;
  fontSize: number;
  fontFamily?: string;
  onDone: () => void;
}

function NamePicker({ names, prizeIndex, animationKey, duration, fontSize, fontFamily, onDone }: NamePickerProps) {
  const effectiveDuration = Math.max(6000, duration);
  const itemH = Math.round(fontSize * 1.2);
  const cardW = Math.min(720, Math.max(400, fontSize * 9));
  const fullList = Array.from({ length: PICKER_REPEATS }, () => names).flat();

  const [translateY, setTranslateY] = useState(-(2 * names.length * itemH));
  const rafRef = useRef(0);
  const startRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (names.length === 0) return;
    doneRef.current = false;
    startRef.current = null;

    const startY = -(2 * names.length * itemH);
    const endY = -(5 * names.length * itemH + prizeIndex * itemH);

    setTranslateY(startY);
    if (prizeIndex < 0 || animationKey === 0) return;

    const frame = (ts: number) => {
      if (doneRef.current) return;
      if (!startRef.current) startRef.current = ts;
      const t = Math.min((ts - startRef.current) / effectiveDuration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setTranslateY(startY + (endY - startY) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        doneRef.current = true;
        setTranslateY(endY);
        onDone();
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => { doneRef.current = true; cancelAnimationFrame(rafRef.current); };
  }, [animationKey, prizeIndex]);

  return (
    <Card className="shadow-2xl bg-card" style={{ padding: "48px 56px" }}>
      <div style={{ width: cardW, height: itemH, overflow: "hidden" }}>
        <div style={{ transform: `translateY(${translateY}px)`, willChange: "transform" }}>
          {fullList.map((name, i) => (
            <div
              key={i}
              style={{
                height: itemH,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize,
                fontWeight: 700,
                lineHeight: 1,
                color: "var(--color-card-foreground)",
                fontFamily: fontFamily || undefined,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

interface RaffleScreenBackground {
  type: "theme" | "image" | "video";
  src: string;
  name: string;
}

interface RaffleScreenProps {
  name?: string | null;
  animationKey?: number;
  background?: "default" | "transparent" | "card" | "media";
  backgroundMedia?: RaffleScreenBackground;
  fontSize?: number;
  fontFamily?: string;
  animType?: "slots" | "wheel" | "picker" | "none";
  animDuration?: number;
  participants?: string[];
  prizeIndex?: number;
}

export function createRaffleScreen() {
  return function RaffleScreenPanel(rawProps: unknown) {
    const {
      name,
      animationKey = 0,
      background = "default",
      backgroundMedia,
      fontSize = 48,
      fontFamily = "",
      animType = "slots" as "slots" | "wheel" | "picker" | "none",
      animDuration = 1600,
      participants = [],
      prizeIndex = -1,
    } = (rawProps ?? {}) as RaffleScreenProps;

    const words = name ? name.trim().split(/\s+/) : [];

    const tiles: { word: number; char: string; idx: number }[] = [];
    let g = 0;
    words.forEach((word, wi) => {
      word.split("").forEach((char) => tiles.push({ word: wi, char, idx: g++ }));
    });

    const [doneTiles, setDoneTiles] = useState(0);
    const allDone = tiles.length > 0 && doneTiles >= tiles.length;

    const [mustSpin, setMustSpin] = useState(false);
    const [wheelDone, setWheelDone] = useState(false);
    const [wheelColors, setWheelColors] = useState(DEFAULT_WHEEL_COLORS);
    const [wheelTextColor, setWheelTextColor] = useState("#ffffff");
    const [primaryRgb, setPrimaryRgb] = useState<RgbColor | null>(null);
    const [viewportWidth, setViewportWidth] = useState(() =>
      typeof window === "undefined" ? 0 : window.innerWidth
    );

    useEffect(() => {
      setDoneTiles(0);
      setWheelDone(false);
      if (animType === "wheel" && prizeIndex >= 0 && animationKey > 0) {
        setMustSpin(true);
      }
    }, [animationKey]);

    useEffect(() => {
      const updateWheelTheme = () => {
        const primary = getCssVariableColor("--primary");
        const primaryForeground = getCssVariableColor("--primary-foreground");
        setPrimaryRgb(primary);
        setWheelColors(createWheelPalette(primary));
        setWheelTextColor(primaryForeground ? rgbToHex(primaryForeground) : getContrastText(primary ?? { r: 54, g: 197, b: 240 }));
      };

      updateWheelTheme();

      if (typeof MutationObserver === "undefined") return;
      const observer = new MutationObserver(updateWheelTheme);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      if (typeof window === "undefined") return;
      const handleResize = () => setViewportWidth(window.innerWidth);
      handleResize();
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, []);

    const handleTileDone = () => setDoneTiles((n) => n + 1);

    const wheelData = participants.length === 0
      ? [{ option: "?" }, { option: "?" }]
      : participants.length === 1
        ? [{ option: participants[0] }, { option: participants[0] }]
        : participants.map((p) => ({ option: p }));

    const isCard = background === "card";
    const p = primaryRgb;
    const glowStyle: CSSProperties = p
      ? { color: "white", textShadow: `0 0 40px rgba(${p.r},${p.g},${p.b},0.5), 0 0 100px rgba(${p.r},${p.g},${p.b},0.25), 0 2px 8px rgba(0,0,0,0.8)` }
      : { color: "white", textShadow: "0 2px 8px rgba(0,0,0,0.8)" };
    const screenStyle: CSSProperties = {
      width: "100vw",
      height: "100vh",
      fontFamily: fontFamily || undefined,
      backgroundColor: undefined,
    };
    const slotTileWidth = Math.round(fontSize * 1.4);
    const slotTileGap = Math.round(fontSize * 0.35);
    const slotWordGap = Math.round(fontSize * 0.9);
    const slotContentWidth = words.reduce((total, word, index) => {
      const letterCount = word.length;
      const wordWidth = letterCount > 0
        ? letterCount * slotTileWidth + Math.max(0, letterCount - 1) * slotTileGap
        : 0;
      return total + wordWidth + (index > 0 ? slotWordGap : 0);
    }, 0);
    const slotPlaceholderWidth = Math.max(400, fontSize * 9, slotContentWidth);
    const slotPlaceholderHeight = Math.round(fontSize * 1.8);
    const slotCardPaddingX = 112;
    const slotViewportGutter = 64;
    const slotMaxContentWidth = viewportWidth > 0
      ? Math.max(240, viewportWidth - slotCardPaddingX - slotViewportGutter)
      : slotPlaceholderWidth;
    const slotScale = Math.min(1, slotMaxContentWidth / slotPlaceholderWidth);
    const slotVisibleWidth = Math.ceil(slotPlaceholderWidth * slotScale);
    const slotVisibleHeight = Math.ceil(slotPlaceholderHeight * slotScale);

    const tilesContent = words.length > 0 && (
      <div className="flex items-center">
        {words.map((_, wi) => (
          <div key={wi} className="flex items-center">
            {wi > 0 && (
              <div
                className="flex items-center justify-center"
                style={{ width: Math.round(fontSize * 0.9) }}
              >
                <div className="w-2 h-2 rounded-full bg-white/20" />
              </div>
            )}
            <div style={{ display: "flex", gap: Math.round(fontSize * 0.35) }}>
              {tiles
                .filter((t) => t.word === wi)
                .map((t) => (
                  <LetterTile
                    key={`${animationKey}-${t.idx}`}
                    char={t.char}
                    index={t.idx}
                    onDone={handleTileDone}
                    duration={animDuration}
                    fontSize={fontSize}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    );

    if (animType === "picker") {
      const hasActivePickerRaffle = animationKey > 0 && prizeIndex >= 0 && participants.length >= 1;

      return (
        <div
          className="w-full h-full relative flex flex-col items-center justify-center gap-6 select-none"
          style={screenStyle}
        >
          <p className="text-3xl tracking-[0.3em] uppercase" style={glowStyle}>
            {t("screen.current_raffle")}
          </p>

          <NamePicker
            names={hasActivePickerRaffle ? participants : []}
            prizeIndex={prizeIndex}
            animationKey={animationKey}
            duration={animDuration}
            fontSize={fontSize}
            fontFamily={fontFamily}
            onDone={() => setDoneTiles(1)}
          />

          <p
            className="text-xl transition-opacity duration-400"
            style={{ opacity: doneTiles > 0 && name ? 1 : 0, ...glowStyle }}
          >
            {t("screen.winner_congratulations", { name: name ?? "" })}
          </p>
        </div>
      );
    }

    if (animType === "wheel") {
      return (
        <div
          className="w-full h-full relative flex flex-col items-center justify-center gap-6 select-none"
          style={screenStyle}
        >
          <p className="text-3xl tracking-[0.3em] uppercase" style={glowStyle}>
            {t("screen.current_raffle")}
          </p>
          <Wheel
            mustStartSpinning={mustSpin}
            prizeNumber={prizeIndex >= 0 ? prizeIndex : 0}
            data={wheelData}
            onStopSpinning={() => { setMustSpin(false); setWheelDone(true); }}
            backgroundColors={wheelColors}
            textColors={[wheelTextColor]}
            outerBorderColor="rgba(255,255,255,0.1)"
            outerBorderWidth={2}
            innerRadius={0}
            radiusLineColor="rgba(255,255,255,0.08)"
            radiusLineWidth={1}
            fontSize={Math.max(10, Math.min(26, Math.floor(220 / wheelData.length)))}
            spinDuration={0.8}
          />
          <p
            className="text-xl transition-opacity duration-400"
            style={{ opacity: wheelDone && name ? 1 : 0, ...glowStyle }}
          >
            {t("screen.winner_congratulations", { name: name ?? "" })}
          </p>
        </div>
      );
    }

    return (
      <div
        className="w-full h-full relative flex flex-col items-center justify-center gap-8 select-none"
        style={screenStyle}
      >
        <p className="text-3xl tracking-[0.3em] uppercase" style={glowStyle}>
          {t("screen.current_raffle")}
        </p>

        {animType === "slots" || isCard ? (
          <Card
            className="flex flex-col items-center shadow-2xl bg-card"
            style={{
              padding: "48px 56px",
              width: slotVisibleWidth + slotCardPaddingX,
              maxWidth: `calc(100vw - ${slotViewportGutter}px)`,
              minHeight: slotVisibleHeight + 80,
            }}
          >
            <div style={{ position: "relative", width: slotVisibleWidth, height: slotVisibleHeight, overflow: "hidden" }}>
              {tilesContent && (
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: slotPlaceholderWidth,
                    height: slotPlaceholderHeight,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transform: `translate(-50%, -50%) scale(${slotScale})`,
                    transformOrigin: "center",
                  }}
                >
                  {tilesContent}
                </div>
              )}
            </div>
          </Card>
        ) : tilesContent}

        <p
          className="text-xl transition-opacity duration-400"
          style={{ opacity: allDone && name ? 1 : 0, ...glowStyle }}
        >
          {t("screen.congratulations")}
        </p>
      </div>
    );
  };
}
