"use client";

import { useEffect, useState } from "react";

const SPORT_ICONS = ["🏒", "⚾", "🏈", "⚽", "🏆"];

export default function SportIcon() {
  const [icon, setIcon] = useState("🏒");

  useEffect(() => {
    const picked = SPORT_ICONS[Math.floor(Math.random() * SPORT_ICONS.length)];
    setIcon(picked);
  }, []);

  return <span>{icon}</span>;
}
