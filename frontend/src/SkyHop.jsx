import { useEffect, useRef, useState, useCallback } from "react";
import { Volume2, VolumeX } from "lucide-react";

// ---- Tuning constants (vertical = fraction of height, horizontal = fraction of width) ----
const BIRD_X = 0.28; // frac W
const BIRD_R = 0.032; // frac H
const GRAVITY = 1.7; // frac H / s^2
const JUMP_V = -0.54; // frac H / s
const PIPE_W = 0.155; // frac W
const GAP = 0.30; // frac H
const SPACING = 0.62; // frac W between successive pipes
const BASE_SPEED = 0.34; // frac W / s
const GROUND = 0.13; // frac H (ground strip height at bottom)
const MAX_DT = 1 / 30;

const HS_KEY = "skyhop_highscore_v1";

// ---------------- Sound engine (Web Audio, no external assets) ----------------
function createSound() {
  let ctx = null;
  const ensure = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  const blip = (freq, dur, type = "sine", vol = 0.12, slideTo = null) => {
    const c = ensure();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  };
  return {
    ensure,
    jump: () => blip(520, 0.12, "square", 0.09, 720),
    score: () => {
      blip(660, 0.09, "triangle", 0.12);
      setTimeout(() => blip(880, 0.11, "triangle", 0.12), 80);
    },
    crash: () => {
      blip(300, 0.18, "sawtooth", 0.16, 90);
      setTimeout(() => blip(140, 0.3, "sawtooth", 0.14, 60), 60);
    },
  };
}

// circle vs rect collision
function hitRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export default function SkyHop() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const soundRef = useRef(null);
  const rafRef = useRef(0);

  const [phase, setPhase] = useState("start"); // start | playing | over
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [muted, setMuted] = useState(false);

  const phaseRef = useRef("start");
  const mutedRef = useRef(false);
  const overAtRef = useRef(0);

  // mutable game state
  const gRef = useRef({
    by: 0.45, // bird y frac H
    vy: 0, // frac H / s
    rot: 0,
    pipes: [], // {x (frac W), gap (frac H center), scored}
    score: 0,
    clouds: [],
    last: 0,
  });

  useEffect(() => {
    soundRef.current = createSound();
    const saved = parseInt(localStorage.getItem(HS_KEY) || "0", 10);
    setHighScore(Number.isFinite(saved) ? saved : 0);
    seedClouds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seedClouds = () => {
    const clouds = [];
    for (let i = 0; i < 5; i++) {
      clouds.push({
        x: Math.random(),
        y: 0.08 + Math.random() * 0.4,
        s: 0.5 + Math.random() * 0.7,
        v: 0.02 + Math.random() * 0.03,
      });
    }
    gRef.current.clouds = clouds;
  };

  const resetRun = useCallback(() => {
    const g = gRef.current;
    g.by = 0.45;
    g.vy = 0;
    g.rot = 0;
    g.score = 0;
    g.pipes = [{ x: 1.05, gap: randomGap(), scored: false }];
    setScore(0);
  }, []);

  const randomGap = () => {
    const half = GAP / 2;
    const min = half + 0.07;
    const max = 1 - GROUND - half - 0.05;
    return min + Math.random() * (max - min);
  };

  const startGame = useCallback(() => {
    soundRef.current && soundRef.current.ensure();
    resetRun();
    phaseRef.current = "playing";
    setPhase("playing");
  }, [resetRun]);

  const endGame = useCallback(() => {
    phaseRef.current = "over";
    overAtRef.current = performance.now();
    setPhase("over");
    const g = gRef.current;
    setHighScore((prev) => {
      const nh = Math.max(prev, g.score);
      localStorage.setItem(HS_KEY, String(nh));
      return nh;
    });
    if (!mutedRef.current) soundRef.current && soundRef.current.crash();
  }, []);

  const flap = useCallback(() => {
    const p = phaseRef.current;
    if (p === "playing") {
      gRef.current.vy = JUMP_V;
      if (!mutedRef.current) soundRef.current && soundRef.current.jump();
    } else if (p === "start") {
      startGame();
    } else if (p === "over") {
      if (performance.now() - overAtRef.current > 450) startGame();
    }
  }, [startGame]);

  // ---------------- Input handlers ----------------
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space" || e.key === " " || e.code === "ArrowUp") {
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [flap]);

  const onPointerDown = (e) => {
    // ignore clicks on buttons (they stopPropagation themselves)
    flap();
  };

  // ---------------- Game loop ----------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let W = 0;
    let H = 0;
    let dpr = 1;

    const resize = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current);

    const step = (t) => {
      const g = gRef.current;
      if (!g.last) g.last = t;
      let dt = (t - g.last) / 1000;
      g.last = t;
      if (dt > MAX_DT) dt = MAX_DT; // clamp to avoid jumps

      const playing = phaseRef.current === "playing";
      const groundY = H * (1 - GROUND);
      const speedMul = Math.min(1.75, 1 + g.score * 0.014);
      const speed = BASE_SPEED * speedMul;

      // update clouds (always)
      for (const c of g.clouds) {
        c.x -= c.v * 0.3 * dt;
        if (c.x < -0.2) {
          c.x = 1.2;
          c.y = 0.08 + Math.random() * 0.4;
          c.s = 0.5 + Math.random() * 0.7;
        }
      }

      if (playing) {
        g.vy += GRAVITY * dt;
        g.by += g.vy * dt;
        // ceiling clamp (touching top does not kill)
        if (g.by < BIRD_R) {
          g.by = BIRD_R;
          if (g.vy < 0) g.vy = 0;
        }
        g.rot = Math.max(-0.5, Math.min(1.2, g.vy * 1.1));

        // move pipes
        for (const p of g.pipes) p.x -= speed * dt;
        // remove offscreen
        while (g.pipes.length && g.pipes[0].x < -PIPE_W - 0.05) g.pipes.shift();
        // spawn
        const last = g.pipes[g.pipes.length - 1];
        if (!last || last.x <= 1 - SPACING) {
          g.pipes.push({
            x: last ? last.x + SPACING : 1.05,
            gap: randomGap(),
            scored: false,
          });
        }

        // collision + score
        const cx = BIRD_X * W;
        const cy = g.by * H;
        const r = BIRD_R * H;
        const pw = PIPE_W * W;
        const gapHalf = (GAP / 2) * H;
        let dead = false;
        for (const p of g.pipes) {
          const px = p.x * W;
          const gcy = p.gap * H;
          const topH = gcy - gapHalf;
          const botY = gcy + gapHalf;
          if (
            hitRect(cx, cy, r, px, 0, pw, topH) ||
            hitRect(cx, cy, r, px, botY, pw, groundY - botY)
          ) {
            dead = true;
          }
          if (!p.scored && cx > px + pw) {
            p.scored = true;
            g.score += 1;
            setScore(g.score);
            if (!mutedRef.current) soundRef.current && soundRef.current.score();
          }
        }
        // floor
        if (cy + r >= groundY) {
          g.by = (groundY - r) / H;
          dead = true;
        }
        if (dead) endGame();
      }

      draw(ctx, W, H, groundY, g);
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endGame]);

  // ---------------- Rendering ----------------
  const draw = (ctx, W, H, groundY, g) => {
    // sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#8fd3f4");
    sky.addColorStop(0.55, "#a8e0f0");
    sky.addColorStop(1, "#d9f4ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // sun
    ctx.fillStyle = "rgba(255, 236, 150, 0.9)";
    ctx.beginPath();
    ctx.arc(W * 0.82, H * 0.18, H * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 245, 190, 0.5)";
    ctx.beginPath();
    ctx.arc(W * 0.82, H * 0.18, H * 0.13, 0, Math.PI * 2);
    ctx.fill();

    // clouds
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (const c of g.clouds) drawCloud(ctx, c.x * W, c.y * H, c.s * H * 0.06);

    // rolling hills (behind ground)
    ctx.fillStyle = "#bfe89a";
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    const hy = groundY - H * 0.05;
    ctx.quadraticCurveTo(W * 0.25, hy - H * 0.05, W * 0.5, hy);
    ctx.quadraticCurveTo(W * 0.75, hy + H * 0.05, W, hy - H * 0.02);
    ctx.lineTo(W, groundY);
    ctx.closePath();
    ctx.fill();

    // pipes
    const pw = PIPE_W * W;
    const gapHalf = (GAP / 2) * H;
    for (const p of g.pipes) {
      const px = p.x * W;
      const gcy = p.gap * H;
      const topH = gcy - gapHalf;
      const botY = gcy + gapHalf;
      drawPipe(ctx, px, 0, pw, topH, true);
      drawPipe(ctx, px, botY, pw, groundY - botY, false);
    }

    // ground
    ctx.fillStyle = "#c9a26b";
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = "#8fd06a";
    ctx.fillRect(0, groundY, W, Math.max(6, H * 0.02));
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    ctx.fillRect(0, groundY + Math.max(6, H * 0.02), W, 3);

    // bird
    drawBird(ctx, BIRD_X * W, g.by * H, BIRD_R * H, g.rot);
  };

  const drawCloud = (ctx, x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r, y + r * 0.2, r * 0.85, 0, Math.PI * 2);
    ctx.arc(x - r, y + r * 0.2, r * 0.8, 0, Math.PI * 2);
    ctx.arc(x + r * 0.2, y + r * 0.4, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawPipe = (ctx, x, y, w, h, isTop) => {
    if (h <= 0) return;
    const r = Math.min(10, w * 0.15);
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, "#5fbf3f");
    grad.addColorStop(0.4, "#7ed957");
    grad.addColorStop(0.5, "#8fe86a");
    grad.addColorStop(0.6, "#7ed957");
    grad.addColorStop(1, "#4fa832");
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    // lip / cap
    const capH = Math.min(h, Math.max(14, w * 0.28));
    const capW = w * 1.16;
    const capX = x - (capW - w) / 2;
    ctx.fillStyle = "#4fa832";
    if (isTop) {
      roundRect(ctx, capX, y + h - capH, capW, capH, r);
    } else {
      roundRect(ctx, capX, y, capW, capH, r);
    }
    ctx.fill();
    // highlight
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    roundRect(ctx, x + w * 0.12, y, w * 0.14, h, r * 0.5);
    ctx.fill();
  };

  const drawBird = (ctx, x, y, r, rot) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // body
    const bg = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
    bg.addColorStop(0, "#ffe27a");
    bg.addColorStop(1, "#ffbe33");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r, 0, 0, Math.PI * 2);
    ctx.fill();
    // wing
    ctx.fillStyle = "#ff9e2c";
    ctx.beginPath();
    ctx.ellipse(-r * 0.2, r * 0.15, r * 0.55, r * 0.38, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // belly
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.ellipse(r * 0.1, r * 0.35, r * 0.6, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(r * 0.5, -r * 0.35, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2b2b2b";
    ctx.beginPath();
    ctx.arc(r * 0.62, -r * 0.35, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    // beak
    ctx.fillStyle = "#ff6b35";
    ctx.beginPath();
    ctx.moveTo(r * 1.05, -r * 0.05);
    ctx.lineTo(r * 1.55, r * 0.12);
    ctx.lineTo(r * 1.05, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const toggleMute = (e) => {
    e.stopPropagation();
    setMuted((m) => {
      mutedRef.current = !m;
      return !m;
    });
  };

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      data-testid="game-area"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        touchAction: "none",
        userSelect: "none",
        cursor: "pointer",
        fontFamily: "'Baloo 2', 'Trebuchet MS', sans-serif",
        overflow: "hidden",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />

      {/* Mute toggle */}
      <button
        data-testid="mute-toggle"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          zIndex: 30,
          width: 44,
          height: 44,
          borderRadius: 14,
          border: "3px solid #ffffff",
          background: "rgba(255,255,255,0.35)",
          backdropFilter: "blur(4px)",
          color: "#2b3a4a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 4px 0 rgba(0,0,0,0.12)",
        }}
      >
        {muted ? <VolumeX size={22} /> : <Volume2 size={22} />}
      </button>

      {/* Live score during play */}
      {phase === "playing" && (
        <div
          data-testid="live-score"
          style={{
            position: "absolute",
            top: "6%",
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: "clamp(40px, 9vh, 84px)",
            fontWeight: 800,
            color: "#ffffff",
            textShadow:
              "0 3px 0 #3b6ea5, 0 0 12px rgba(0,0,0,0.25), 2px 2px 0 #2b3a4a",
            pointerEvents: "none",
          }}
        >
          {score}
        </div>
      )}

      {/* Start overlay */}
      {phase === "start" && (
        <Overlay>
          <Title />
          <div style={panelStyle} data-testid="start-panel">
            <p style={{ margin: "0 0 6px", fontSize: "clamp(15px,2.4vh,20px)", color: "#2b3a4a", fontWeight: 700 }}>
              How to play
            </p>
            <p style={{ margin: 0, fontSize: "clamp(13px,2vh,17px)", color: "#4a5a6a", lineHeight: 1.5 }}>
              Tap the screen, click, or press <b>Space</b> to flap.
              <br />
              Fly through the gaps and don't hit anything!
            </p>
          </div>
          <PlayButton
            testId="start-button"
            label="Start"
            onClick={(e) => {
              e.stopPropagation();
              startGame();
            }}
          />
          <p style={hintStyle}>Best: {highScore}</p>
        </Overlay>
      )}

      {/* Game over overlay */}
      {phase === "over" && (
        <Overlay>
          <h2
            data-testid="gameover-title"
            style={{
              margin: 0,
              fontSize: "clamp(34px,7vh,64px)",
              fontWeight: 900,
              color: "#fff",
              textShadow: "0 4px 0 #d1495b, 2px 2px 0 #2b3a4a",
            }}
          >
            Game Over
          </h2>
          <div style={panelStyle} data-testid="gameover-panel">
            <ScoreRow label="Score" value={score} testId="final-score" />
            <div style={{ height: 10 }} />
            <ScoreRow label="Best" value={highScore} testId="high-score" gold />
            {score >= highScore && score > 0 && (
              <p
                data-testid="new-best"
                style={{ margin: "10px 0 0", color: "#f0a500", fontWeight: 800, fontSize: "clamp(13px,2vh,16px)" }}
              >
                ★ New Best! ★
              </p>
            )}
          </div>
          <PlayButton
            testId="restart-button"
            label="Play Again"
            onClick={(e) => {
              e.stopPropagation();
              startGame();
            }}
          />
          <p style={hintStyle}>Tap or press Space to restart</p>
        </Overlay>
      )}
    </div>
  );
}

// ---------------- small helpers / presentational ----------------
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const panelStyle = {
  background: "rgba(255,255,255,0.85)",
  borderRadius: 20,
  padding: "18px 26px",
  margin: "18px 0",
  boxShadow: "0 8px 0 rgba(0,0,0,0.12)",
  border: "3px solid #ffffff",
  textAlign: "center",
  maxWidth: 340,
};

const hintStyle = {
  marginTop: 16,
  color: "#ffffff",
  fontSize: "clamp(13px,2vh,16px)",
  fontWeight: 700,
  textShadow: "0 2px 0 rgba(0,0,0,0.2)",
};

function Overlay({ children }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        textAlign: "center",
        background: "rgba(40,80,120,0.18)",
        animation: "shFade 0.25s ease",
      }}
    >
      {children}
    </div>
  );
}

function Title() {
  return (
    <h1
      data-testid="game-title"
      style={{
        margin: 0,
        fontSize: "clamp(44px,10vh,96px)",
        fontWeight: 900,
        letterSpacing: 1,
        lineHeight: 1,
        color: "#ffe27a",
        textShadow:
          "0 5px 0 #ff9e2c, 0 8px 0 #e07b00, 3px 3px 0 #2b3a4a, -2px -2px 0 #2b3a4a",
      }}
    >
      SkyHop
    </h1>
  );
}

function PlayButton({ label, onClick, testId }) {
  return (
    <button
      data-testid={testId}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      style={{
        marginTop: 6,
        padding: "14px 46px",
        fontSize: "clamp(18px,3vh,26px)",
        fontWeight: 900,
        color: "#fff",
        background: "linear-gradient(#ff8a3d, #ff6b1a)",
        border: "4px solid #ffffff",
        borderRadius: 999,
        cursor: "pointer",
        boxShadow: "0 6px 0 #c74e00",
        transition: "transform 0.08s ease, box-shadow 0.08s ease",
        fontFamily: "inherit",
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = "translateY(4px)";
        e.currentTarget.style.boxShadow = "0 2px 0 #c74e00";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "0 6px 0 #c74e00";
      }}
    >
      {label}
    </button>
  );
}

function ScoreRow({ label, value, gold, testId }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
      <span style={{ fontSize: "clamp(15px,2.6vh,22px)", fontWeight: 700, color: "#4a5a6a" }}>
        {label}
      </span>
      <span
        data-testid={testId}
        style={{
          fontSize: "clamp(26px,5vh,46px)",
          fontWeight: 900,
          color: gold ? "#f0a500" : "#2b3a4a",
        }}
      >
        {value}
      </span>
    </div>
  );
}
