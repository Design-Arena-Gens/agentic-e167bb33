"use client";

import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  OrbitControls,
  Sky,
  Stats,
} from "@react-three/drei";
import { Suspense, useMemo, useState } from "react";
import * as THREE from "three";

type TrackingMode = "auto" | "manual";

type SolarState = {
  latitude: number;
  longitude: number;
  utcOffset: number;
  date: string;
  time: string;
  trackingMode: TrackingMode;
  manualPitch: number;
  manualYaw: number;
  panelWidth: number;
  panelHeight: number;
  panelElevation: number;
  albedo: number;
};

type SunPosition = {
  azimuth: number;
  elevation: number;
  vector: THREE.Vector3;
};

const degToRad = (deg: number) => (deg * Math.PI) / 180;
const radToDeg = (rad: number) => (rad * 180) / Math.PI;

function normalizeAngle(angle: number) {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function calculateSunPosition(state: SolarState): SunPosition {
  const dateTime = new Date(`${state.date}T${state.time}:00`);
  const utcOffset = state.utcOffset;

  const timeZone = utcOffset;
  const longitude = state.longitude;
  const latitude = state.latitude;

  const totalMinutes =
    dateTime.getHours() * 60 + dateTime.getMinutes() + dateTime.getSeconds() / 60;

  const year = dateTime.getUTCFullYear();
  const month = dateTime.getUTCMonth() + 1;
  const day = dateTime.getUTCDate();

  const A = Math.floor((14 - month) / 12);
  const Y = year + 4800 - A;
  const M = month + 12 * A - 3;
  const julianDay =
    day +
    Math.floor((153 * M + 2) / 5) +
    365 * Y +
    Math.floor(Y / 4) -
    Math.floor(Y / 100) +
    Math.floor(Y / 400) -
    32045;

  const julianDayWithTime =
    julianDay +
    (dateTime.getUTCHours() - utcOffset + dateTime.getUTCMinutes() / 60) / 24 -
    0.5;
  const julianCentury = (julianDayWithTime - 2451545) / 36525;

  const geomMeanLongSun =
    normalizeAngle(
      280.46646 + julianCentury * (36000.76983 + 0.0003032 * julianCentury),
    ) || 0;

  const geomMeanAnomSun =
    357.52911 + julianCentury * (35999.05029 - 0.0001537 * julianCentury);

  const eccentEarthOrbit =
    0.016708634 -
    julianCentury * (0.000042037 + 0.0000001267 * julianCentury);

  const sunEqOfCenter =
    Math.sin(degToRad(geomMeanAnomSun)) *
      (1.914602 - julianCentury * (0.004817 + 0.000014 * julianCentury)) +
    Math.sin(degToRad(2 * geomMeanAnomSun)) *
      (0.019993 - 0.000101 * julianCentury) +
    Math.sin(degToRad(3 * geomMeanAnomSun)) * 0.000289;

  const sunTrueLong = geomMeanLongSun + sunEqOfCenter;
  const sunAppLong =
    sunTrueLong -
    0.00569 -
    0.00478 * Math.sin(degToRad(125.04 - 1934.136 * julianCentury));

  const meanObliqEcliptic =
    23 +
    (26 +
      (21.448 -
        julianCentury *
          (46.815 + julianCentury * (0.00059 - julianCentury * 0.001813)))) /
      60;

  const obliqCorr =
    meanObliqEcliptic +
    0.00256 *
      Math.cos(degToRad(125.04 - 1934.136 * julianCentury));

  const sunDeclination = radToDeg(
    Math.asin(
      Math.sin(degToRad(obliqCorr)) * Math.sin(degToRad(sunAppLong)),
    ),
  );

  const varY =
    Math.tan(degToRad(obliqCorr / 2)) *
    Math.tan(degToRad(obliqCorr / 2));

  const eqOfTime =
    4 *
    radToDeg(
      varY * Math.sin(2 * degToRad(geomMeanLongSun)) -
        2 * eccentEarthOrbit * Math.sin(degToRad(geomMeanAnomSun)) +
        4 *
          eccentEarthOrbit *
          varY *
          Math.sin(degToRad(geomMeanAnomSun)) *
          Math.cos(2 * degToRad(geomMeanLongSun)) -
        0.5 *
          varY *
          varY *
          Math.sin(4 * degToRad(geomMeanLongSun)) -
        1.25 *
          eccentEarthOrbit *
          eccentEarthOrbit *
          Math.sin(2 * degToRad(geomMeanAnomSun)),
    );

  let trueSolarTime =
    totalMinutes + eqOfTime + 4 * longitude - 60 * timeZone;
  trueSolarTime = ((trueSolarTime % 1440) + 1440) % 1440;

  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  const haRad = degToRad(hourAngle);
  const latRad = degToRad(latitude);
  const declRad = degToRad(sunDeclination);

  const cosZenith =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad);
  const zenith = Math.min(Math.acos(Math.max(cosZenith, -1)), Math.PI);
  const elevation = 90 - radToDeg(zenith);

  const azDenominator =
    Math.cos(latRad) * Math.sin(zenith);
  let azimuth = 0;
  if (Math.abs(azDenominator) > 0.001) {
    let azRad = Math.acos(
      Math.min(
        Math.max(
          (Math.sin(latRad) * Math.cos(zenith) -
            Math.sin(declRad)) /
            azDenominator,
          -1,
        ),
        1,
      ),
    );
    if (Math.sin(haRad) > 0) {
      azRad = 2 * Math.PI - azRad;
    }
    azimuth = normalizeAngle(radToDeg(azRad));
  }

  const elevationClamped = Math.max(elevation, -5);
  const elevationRad = degToRad(elevationClamped);
  const azimuthRad = degToRad(azimuth);

  const sunVector = new THREE.Vector3(
    Math.sin(azimuthRad) * Math.cos(elevationRad),
    Math.sin(elevationRad),
    Math.cos(azimuthRad) * Math.cos(elevationRad),
  ).normalize();

  return {
    azimuth,
    elevation: elevationClamped,
    vector: sunVector,
  };
}

function getPanelNormal(state: SolarState, sun: SunPosition) {
  const pitch = state.trackingMode === "auto" ? sun.elevation : state.manualPitch;
  const yaw = state.trackingMode === "auto" ? sun.azimuth : state.manualYaw;
  const pitchRad = degToRad(pitch);
  const yawRad = degToRad(yaw);

  const vector = new THREE.Vector3(
    Math.sin(yawRad) * Math.cos(pitchRad),
    Math.sin(pitchRad),
    Math.cos(yawRad) * Math.cos(pitchRad),
  ).normalize();

  return {
    vector,
    pitch,
    yaw,
  };
}

type PanelProps = {
  pitch: number;
  yaw: number;
  width: number;
  height: number;
  elevation: number;
};

function PanelAssembly({ pitch, yaw, width, height, elevation }: PanelProps) {
  const yawRad = degToRad(normalizeAngle(yaw));
  const pitchClamped = Math.min(Math.max(pitch, 0), 90);
  const pitchRad = degToRad(pitchClamped);

  return (
    <group position={[0, elevation, 0]}>
      <mesh position={[0, -elevation / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[0.18, elevation, 0.18]} />
        <meshStandardMaterial color="#4b5563" metalness={0.3} roughness={0.55} />
      </mesh>

      <group rotation={[0, yawRad, 0]}>
        <mesh position={[0, 0, 0]} receiveShadow castShadow>
          <boxGeometry args={[0.2, 0.2, 0.2]} />
          <meshStandardMaterial color="#6b7280" metalness={0.4} roughness={0.6} />
        </mesh>

        <group rotation={[-pitchRad, 0, 0]}>
          <mesh receiveShadow castShadow>
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial
              color="#1d4ed8"
              metalness={0.5}
              roughness={0.35}
            />
          </mesh>

          <mesh position={[0, height / 2 + 0.015, 0]} castShadow>
            <boxGeometry args={[width, 0.03, 0.04]} />
            <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, -height / 2 - 0.015, 0]} castShadow>
            <boxGeometry args={[width, 0.03, 0.04]} />
            <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[width / 2 + 0.015, 0, 0]} castShadow>
            <boxGeometry args={[0.03, height + 0.03, 0.04]} />
            <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[-width / 2 - 0.015, 0, 0]} castShadow>
            <boxGeometry args={[0.03, height + 0.03, 0.04]} />
            <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.4} />
          </mesh>

          <mesh position={[0, 0, -0.08]} castShadow>
            <boxGeometry args={[0.15, height, 0.04]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.3} roughness={0.5} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

type GroundProps = { size?: number; albedo: number };

function Ground({ size = 20, albedo }: GroundProps) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={`hsl(150, 30%, ${50 * albedo}%)`} />
    </mesh>
  );
}

type SunProps = {
  position: THREE.Vector3;
};

function Sun({ position }: SunProps) {
  return (
    <group position={position.toArray()}>
      <mesh>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial
          color="#facc15"
          emissive="#fde047"
          emissiveIntensity={2}
          metalness={0.1}
          roughness={0.2}
        />
      </mesh>
      <pointLight
        position={[0, 0, 0]}
        intensity={3}
        decay={2}
        distance={50}
        castShadow
      />
    </group>
  );
}

type MetricsProps = {
  sun: SunPosition;
  panelNormal: THREE.Vector3;
};

function Metrics({ sun, panelNormal }: MetricsProps) {
  const dot = sun.vector.dot(panelNormal);
  const angle = Math.acos(Math.min(Math.max(dot, -1), 1));
  const angleDeg = radToDeg(angle);
  const effectiveIrradiance = Math.max(0, Math.cos(angle));

  return (
    <div className="rounded-xl bg-white/70 p-4 shadow-lg backdrop-blur dark:bg-neutral-900/70">
      <h3 className="text-sm font-semibold tracking-tight text-neutral-700 dark:text-neutral-100">
        Indicateurs instantanés
      </h3>
      <dl className="mt-3 grid grid-cols-2 gap-4 text-sm text-neutral-600 dark:text-neutral-200">
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Azimut solaire
          </dt>
          <dd>{sun.azimuth.toFixed(1)}°</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Hauteur solaire
          </dt>
          <dd>{sun.elevation.toFixed(1)}°</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Angle d&apos;incidence
          </dt>
          <dd>{angleDeg.toFixed(1)}°</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Flux capté
          </dt>
          <dd>{(effectiveIrradiance * 100).toFixed(0)}%</dd>
        </div>
      </dl>
    </div>
  );
}

export default function SolarTrackerSimulator() {
  const [state, setState] = useState<SolarState>(() => {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);
    return {
      latitude: 48.8566,
      longitude: 2.3522,
      utcOffset: -now.getTimezoneOffset() / 60,
      date,
      time,
      trackingMode: "auto",
      manualPitch: 30,
      manualYaw: 180,
      panelWidth: 2.0,
      panelHeight: 1.2,
      panelElevation: 1.2,
      albedo: 0.45,
    };
  });

  const sun = useMemo(() => calculateSunPosition(state), [state]);
  const panel = useMemo(() => getPanelNormal(state, sun), [state, sun]);

  const sunPosition = sun.vector.clone().multiplyScalar(20);

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-900 p-6 text-white lg:flex-row">
      <div className="w-full space-y-6 lg:max-w-xs">
        <div className="rounded-2xl bg-white/10 p-5 shadow-lg backdrop-blur">
          <h2 className="text-lg font-semibold">Suivi Solaire Biaxial</h2>
          <p className="mt-1 text-sm text-slate-200">
            Ajustez les paramètres pour simuler un système de pilotage de panneaux solaires.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-200">
              Latitude (°)
              <input
                type="number"
                className="mt-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-300"
                value={state.latitude}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    latitude: Number(event.target.value),
                  }))
                }
                step={0.1}
              />
            </label>
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-200">
              Longitude (°)
              <input
                type="number"
                className="mt-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-300"
                value={state.longitude}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    longitude: Number(event.target.value),
                  }))
                }
                step={0.1}
              />
            </label>
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-200">
              Offset UTC (h)
              <input
                type="number"
                className="mt-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-300"
                value={state.utcOffset}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    utcOffset: Number(event.target.value),
                  }))
                }
                step={0.5}
              />
            </label>
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-200">
              Date
              <input
                type="date"
                className="mt-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-300"
                value={state.date}
                onChange={(event) =>
                  setState((prev) => ({ ...prev, date: event.target.value }))
                }
              />
            </label>
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-200">
              Heure
              <input
                type="time"
                className="mt-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-300"
                value={state.time}
                onChange={(event) =>
                  setState((prev) => ({ ...prev, time: event.target.value }))
                }
              />
            </label>
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-200">
              Albedo sol
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={state.albedo}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    albedo: Number(event.target.value),
                  }))
                }
                className="mt-2"
              />
              <span className="mt-1 text-right text-[11px] text-slate-200">
                {(state.albedo * 100).toFixed(0)} %
              </span>
            </label>
          </div>
        </div>

        <div className="rounded-2xl bg-white/10 p-5 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Mode de pilotage</span>
            <div className="flex gap-2 rounded-full bg-white/10 p-1">
              <button
                type="button"
                className={`rounded-full px-4 py-1 text-xs uppercase tracking-wide transition ${
                  state.trackingMode === "auto"
                    ? "bg-white text-slate-900"
                    : "text-slate-200"
                }`}
                onClick={() =>
                  setState((prev) => ({ ...prev, trackingMode: "auto" }))
                }
              >
                Automatique
              </button>
              <button
                type="button"
                className={`rounded-full px-4 py-1 text-xs uppercase tracking-wide transition ${
                  state.trackingMode === "manual"
                    ? "bg-white text-slate-900"
                    : "text-slate-200"
                }`}
                onClick={() =>
                  setState((prev) => ({ ...prev, trackingMode: "manual" }))
                }
              >
                Manuel
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 text-xs uppercase tracking-wide text-slate-200">
            <label className="col-span-2">
              Largeur panneau (m)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-300"
                value={state.panelWidth}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    panelWidth: Number(event.target.value),
                  }))
                }
                step={0.1}
                min={0.5}
              />
            </label>
            <label className="col-span-2">
              Hauteur panneau (m)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-300"
                value={state.panelHeight}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    panelHeight: Number(event.target.value),
                  }))
                }
                step={0.1}
                min={0.5}
              />
            </label>
            <label className="col-span-2">
              Hauteur mât (m)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-300"
                value={state.panelElevation}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    panelElevation: Number(event.target.value),
                  }))
                }
                step={0.1}
                min={0.5}
              />
            </label>

            <label className="col-span-2">
              Yaw manuel (°)
              <input
                type="range"
                min={0}
                max={360}
                value={state.manualYaw}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    manualYaw: Number(event.target.value),
                  }))
                }
                disabled={state.trackingMode === "auto"}
                className="mt-2"
              />
              <span className="mt-1 block text-right text-[11px] text-slate-200">
                {state.manualYaw.toFixed(0)}°
              </span>
            </label>
            <label className="col-span-2">
              Inclinaison (°)
              <input
                type="range"
                min={0}
                max={90}
                value={state.manualPitch}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    manualPitch: Number(event.target.value),
                  }))
                }
                disabled={state.trackingMode === "auto"}
                className="mt-2"
              />
              <span className="mt-1 block text-right text-[11px] text-slate-200">
                {state.manualPitch.toFixed(0)}°
              </span>
            </label>
          </div>
        </div>

        <Metrics sun={sun} panelNormal={panel.vector} />
      </div>

      <div className="flex-1 rounded-3xl bg-black/30 p-4 shadow-2xl backdrop-blur">
        <div className="relative h-[70vh] w-full overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900 via-slate-950 to-black">
          <Canvas
            shadows
            camera={{ position: [8, 6, 8], fov: 45 }}
          >
            <Suspense fallback={null}>
              <Sky
                distance={450000}
                turbidity={6}
                rayleigh={3}
                inclination={0.49}
                azimuth={(sun.azimuth % 360) / 360}
              />
              <ambientLight intensity={0.5} />
              <directionalLight
                position={sunPosition.toArray()}
                intensity={2.5}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
              />
              <Sun position={sunPosition} />
              <PanelAssembly
                pitch={panel.pitch}
                yaw={panel.yaw}
                width={state.panelWidth}
                height={state.panelHeight}
                elevation={state.panelElevation}
              />
              <Ground albedo={state.albedo} />
              <ContactShadows
                position={[0, 0, 0]}
                opacity={0.5}
                width={10}
                height={10}
                blur={2.5}
                far={20}
              />
              <Environment preset="sunset" />
              <gridHelper args={[20, 20, "#1f2937", "#1f2937"]} />
              <axesHelper args={[1.5]} />
              <OrbitControls
                enablePan
                enableZoom
                maxPolarAngle={Math.PI / 2 - 0.1}
                minDistance={5}
                maxDistance={20}
              />
              <Stats />
            </Suspense>
          </Canvas>
        </div>
      </div>
    </div>
  );
}
