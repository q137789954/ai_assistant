"use client";

import { useEffect, useRef } from "react";

export default function SpineStage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<any>(null);

  useEffect(() => {
    let destroyed = false;

    async function init() {
      if (!hostRef.current) return;
      if (appRef.current) return; // 避免 StrictMode 下重复初始化

      // 关键：动态 import，确保只在浏览器执行
      const PIXI = await import("pixi.js");
      const spineMod = await import("@pixi-spine/all-4.1");
      const { Spine } = spineMod;

      const app = new PIXI.Application({
        backgroundColor: 0x111111,
        resizeTo: hostRef.current,
        antialias: true,
      });

      appRef.current = app;
      hostRef.current.appendChild(app.view);

      // 加载 Spine（json 会引用 atlas，再引用 png）
      // Pixi v7 的 Assets.load 支持加载 spine，并返回 { spineData, spineAtlas } 之类对象。:contentReference[oaicite:2]{index=2}
      const resource: any = await PIXI.Assets.load("/animation/dance/animation.json");
      if (destroyed) return;

      const spine = new Spine(resource.spineData);
      app.stage.addChild(spine);

      // 打印动画名，默认播放第一个
      const animNames = (spine.spineData?.animations || []).map((a: any) => a.name);
      console.log("Spine animations:", animNames);

      const firstAnim = animNames[0];
      if (!firstAnim) throw new Error("没有读取到动画名：请确认 animation.json 是 Spine skeleton JSON");

      spine.state.setAnimation(0, firstAnim, true);
      spine.state.timeScale = 1;

      // 适配居中/缩放（y 往下放一点，通常脚底更贴地）
      const fit = () => {
        const w = app.renderer.width;
        const h = app.renderer.height;

        spine.x = w / 2;
        spine.y = h * 0.85;

        const b = spine.getLocalBounds();
        const contentW = Math.max(1, b.width);
        const contentH = Math.max(1, b.height);
        const s = Math.min((w * 0.55) / contentW, (h * 0.85) / contentH);

        spine.scale.set(s);
      };
      fit();

      // 键盘控制：Space 暂停/继续，R 重播，+/- 调速
      let paused = false;
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code === "Space") {
          paused = !paused;
          spine.state.timeScale = paused ? 0 : 1;
        }
        if (e.key.toLowerCase() === "r") {
          spine.state.setAnimation(0, firstAnim, true);
        }
        if (e.key === "+" || e.key === "=") {
          spine.state.timeScale = Math.min(spine.state.timeScale + 0.1, 3);
          console.log("timeScale:", spine.state.timeScale.toFixed(2));
        }
        if (e.key === "-" || e.key === "_") {
          spine.state.timeScale = Math.max(spine.state.timeScale - 0.1, 0);
          console.log("timeScale:", spine.state.timeScale.toFixed(2));
        }
      };

      window.addEventListener("resize", fit);
      window.addEventListener("keydown", onKeyDown);

      // cleanup 保存下来
      return () => {
        window.removeEventListener("resize", fit);
        window.removeEventListener("keydown", onKeyDown);
      };
    }

    let cleanup: null | (() => void) = null;

    init()
      .then((c: any) => {
        cleanup = typeof c === "function" ? c : null;
      })
      .catch((err) => {
        console.error(err);
        alert(err?.message || String(err));
      });

    return () => {
      destroyed = true;
      try {
        cleanup?.();
      } catch {}

      const app = appRef.current;
      appRef.current = null;

      if (app) {
        // 释放 GPU/纹理资源
        app.destroy(true, { children: true, texture: true, baseTexture: true });
      }
      hostRef.current?.replaceChildren();
    };
  }, []);

  return <main style={{ width: "100vw", height: "100vh", background: "#111" }}><div ref={hostRef} style={{ width: "100%", height: "100%" }} />;</main>
}
