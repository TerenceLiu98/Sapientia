import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"

export type PaperStarItem = {
	id: string
	title: string
	authors: string[] | null
	year: number | null
	venue: string | null
	parseStatus: string
	summaryStatus: string
}

type Particle = {
	x: number
	y: number
	z: number
	speed: number
	size: number
	trail: number
	intensity: number
	angularSpeed: number
	curvePhase: number
	curveRadius: number
	curveSpeed: number
	item: PaperStarItem | null
}

type HoverState = {
	item: PaperStarItem
	x: number
	y: number
} | null

const AMBIENT_PARTICLE_COUNT = 160
const MAX_INTERACTIVE_STARS = 48
const FIELD_DEPTH = 120
const FIELD_WIDTH = 62
const FIELD_HEIGHT = 36
const TRAIL_SAMPLES = 10

const STARFIELD_VERTEX_SHADER = `
	attribute float aSize;
	attribute float aIntensity;

	uniform float uPixelRatio;

	varying float vIntensity;

	void main() {
		vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
		float depth = max(1.0, -mvPosition.z);
		vIntensity = aIntensity;
		gl_PointSize = clamp(aSize * (120.0 / depth) * uPixelRatio, 2.0, 180.0);
		gl_Position = projectionMatrix * mvPosition;
	}
`

const STARFIELD_FRAGMENT_SHADER = `
	precision highp float;

	uniform vec3 uColor;

	varying float vIntensity;

	void main() {
		vec2 uv = gl_PointCoord * 2.0 - 1.0;
		float radius = length(uv);
		float core = 1.0 - smoothstep(0.0, 0.3, radius);
		float halo = 1.0 - smoothstep(0.18, 0.72, radius);
		float alpha = core * 1.16 + halo * 0.035;
		alpha = clamp(alpha * vIntensity, 0.0, 1.0);

		if (alpha < 0.01) discard;
		gl_FragColor = vec4(uColor, alpha);
	}
`

export function PaperStarfieldCanvas({
	colorMode,
	items,
	isInputFocused,
	onPaperSelect,
}: {
	colorMode: "light" | "dark"
	items: PaperStarItem[]
	isInputFocused: boolean
	onPaperSelect: (paperId: string) => void
}) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const rendererRef = useRef<any>(null)
	const cameraRef = useRef<any>(null)
	const sceneRef = useRef<any>(null)
	const particlesRef = useRef<Particle[]>([])
	const paperMeshesRef = useRef<any[]>([])
	const paperStarsRef = useRef<PaperStarItem[]>([])
	const pointsMaterialRef = useRef<any>(null)
	const pointsRef = useRef<any>(null)
	const animationRef = useRef<number | null>(null)
	const pointerRef = useRef(new THREE.Vector2(10, 10))
	const hoveredMeshRef = useRef<any>(null)
	const isInputFocusedRef = useRef(isInputFocused)
	const [hovered, setHovered] = useState<HoverState>(null)

	const paperStars = useMemo(() => items.slice(0, MAX_INTERACTIVE_STARS), [items])

	useEffect(() => {
		paperStarsRef.current = paperStars
		syncParticleItems(particlesRef.current, paperMeshesRef.current, paperStars)
	}, [paperStars])

	useEffect(() => {
		isInputFocusedRef.current = isInputFocused
	}, [isInputFocused])

	useEffect(() => {
		const material = pointsMaterialRef.current
		if (material?.uniforms?.uColor?.value) {
			material.uniforms.uColor.value.set(colorMode === "dark" ? 0xffffff : 0x000000)
		}
		const paperColor = colorMode === "dark" ? 0xffffff : 0x1f1f1f
		for (const mesh of paperMeshesRef.current) {
			mesh.material.color.set(paperColor)
		}
	}, [colorMode])

	const resetParticle = useCallback((particle: Particle, seedOffset = 0) => {
		const seed = Math.random() * 10000 + seedOffset
		const spawn = randomSpawnPosition(-FIELD_DEPTH - randomRange(0, 42))
		particle.x = spawn.x
		particle.y = spawn.y
		particle.z = -FIELD_DEPTH - randomRange(0, 28)
		particle.speed = speedForSeed(seed + 19.3, Boolean(particle.item))
		particle.size = sizeForSeed(seed + 23.9, Boolean(particle.item))
		particle.trail = trailForSeed(seed + 29.4, Boolean(particle.item))
		particle.intensity = intensityForSeed(seed + 31.1, Boolean(particle.item))
		particle.angularSpeed = randomAngularSpeed()
		particle.curvePhase = randomRange(0, Math.PI * 2)
		particle.curveRadius = randomCurveRadius(Boolean(particle.item))
		particle.curveSpeed = randomCurveSpeed()
	}, [])

	useEffect(() => {
		const canvas = canvasRef.current
		const container = containerRef.current
		if (!canvas || !container) return

		const renderer = new THREE.WebGLRenderer({
			alpha: true,
			antialias: true,
			canvas,
			powerPreference: "high-performance",
		})
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
		renderer.setClearColor(0x000000, 0)
		rendererRef.current = renderer

		const scene = new THREE.Scene()
		scene.fog = new THREE.FogExp2(0x000000, 0.028)
		sceneRef.current = scene

		const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 160)
		camera.position.set(0, 0, 14)
		cameraRef.current = camera

		const particles = buildParticles(paperStarsRef.current)
		particlesRef.current = particles

		const pointsGeometry = new THREE.BufferGeometry()
		pointsGeometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(new Float32Array(particles.length * TRAIL_SAMPLES * 3), 3),
		)
		pointsGeometry.setAttribute(
			"aSize",
			new THREE.Float32BufferAttribute(new Float32Array(particles.length * TRAIL_SAMPLES), 1),
		)
		pointsGeometry.setAttribute(
			"aIntensity",
			new THREE.Float32BufferAttribute(new Float32Array(particles.length * TRAIL_SAMPLES), 1),
		)
		const pointsMaterial = new THREE.ShaderMaterial({
			blending: THREE.NormalBlending,
			depthWrite: false,
			fragmentShader: STARFIELD_FRAGMENT_SHADER,
			uniforms: {
				uColor: {
					value:
						colorMode === "dark"
							? new THREE.Color(1, 1, 1)
							: new THREE.Color(0, 0, 0),
				},
				uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
			},
			vertexShader: STARFIELD_VERTEX_SHADER,
			transparent: true,
		})
		pointsMaterialRef.current = pointsMaterial
		const points = new THREE.Points(pointsGeometry, pointsMaterial)
		pointsRef.current = points
		scene.add(points)

		const paperMeshes = particles
			.slice(0, MAX_INTERACTIVE_STARS)
			.map((particle) => {
				const geometry = new THREE.SphereGeometry(0.045, 16, 16)
				const material = new THREE.MeshBasicMaterial({
					color: colorMode === "dark" ? 0xffffff : 0x1f1f1f,
					opacity: 0,
					transparent: true,
				})
				const mesh = new THREE.Mesh(geometry, material)
				mesh.userData.item = particle.item
				mesh.userData.particle = particle
				mesh.visible = Boolean(particle.item)
				scene.add(mesh)
				return mesh
			})
		paperMeshesRef.current = paperMeshes
		syncParticleItems(particles, paperMeshes, paperStarsRef.current)

		const resize = () => {
			const rect = container.getBoundingClientRect()
			const width = Math.max(rect.width, 1)
			const height = Math.max(rect.height, 1)
			renderer.setSize(width, height, false)
			camera.aspect = width / height
			camera.updateProjectionMatrix()
		}

		const raycaster = new THREE.Raycaster()
		raycaster.params.Points = { threshold: 0.12 }
		const projected = new THREE.Vector3()
		let lastFrameTime = performance.now()
		let elapsedSeconds = 0

		const animate = () => {
			const now = performance.now()
			const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05)
			lastFrameTime = now
			elapsedSeconds += deltaSeconds
			const focusedMultiplier = isInputFocusedRef.current ? 0.9 : 1
			const pulse = 0.96 + Math.sin(elapsedSeconds * 0.8) * 0.04
			const pointPositions = pointsGeometry.getAttribute("position")
			const pointSizes = pointsGeometry.getAttribute("aSize")
			const pointIntensities = pointsGeometry.getAttribute("aIntensity")

			for (let index = 0; index < particles.length; index += 1) {
				const particle = particles[index]
				const isInteractive = Boolean(particle.item)
				rotateParticle(particle, particle.angularSpeed * focusedMultiplier * (deltaSeconds * 60))
				particle.z += particle.speed * focusedMultiplier * (deltaSeconds * 60)
				if (particle.z > camera.position.z + 4) resetParticle(particle, index)

				writeParticleTrail({
					elapsedSeconds,
					index,
					isInteractive,
					particle,
					positions: pointPositions,
					pulse,
					sizes: pointSizes,
					intensities: pointIntensities,
				})
			}

			pointPositions.needsUpdate = true
			pointSizes.needsUpdate = true
			pointIntensities.needsUpdate = true

			for (const mesh of paperMeshes) {
				const particle = mesh.userData.particle as Particle
				mesh.position.set(particle.x, particle.y, particle.z)
				mesh.scale.setScalar(mesh === hoveredMeshRef.current ? 2.1 : 1)
				mesh.visible = Boolean(particle.item)
			}

			raycaster.setFromCamera(pointerRef.current, camera)
			const hits = raycaster.intersectObjects(paperMeshes, false)
			const nextHover = hits[0]?.object
			hoveredMeshRef.current = nextHover ?? null
			if (nextHover?.userData.item) {
				projected.copy(nextHover.position).project(camera)
				const rect = renderer.domElement.getBoundingClientRect()
				setHovered({
					item: nextHover.userData.item as PaperStarItem,
					x: ((projected.x + 1) / 2) * rect.width,
					y: ((-projected.y + 1) / 2) * rect.height,
				})
			} else {
				setHovered(null)
			}

			renderer.render(scene, camera)
			animationRef.current = window.requestAnimationFrame(animate)
		}

		resize()
		animationRef.current = window.requestAnimationFrame(animate)
		window.addEventListener("resize", resize)

		return () => {
			window.removeEventListener("resize", resize)
			if (animationRef.current !== null) window.cancelAnimationFrame(animationRef.current)
			pointsGeometry.dispose()
			pointsMaterial.dispose()
			pointsMaterialRef.current = null
			for (const mesh of paperMeshes) {
				mesh.geometry.dispose()
				mesh.material.dispose()
			}
			renderer.dispose()
		}
	}, [resetParticle])

	const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect()
		pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
		pointerRef.current.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
	}, [])

	const handlePointerLeave = useCallback(() => {
		pointerRef.current.set(10, 10)
	}, [])

	const handleClick = useCallback(() => {
		const item = hoveredMeshRef.current?.userData.item as PaperStarItem | undefined
		if (item) onPaperSelect(item.id)
	}, [onPaperSelect])

	return (
		<div
			className={`absolute inset-0 overflow-hidden ${
				colorMode === "dark" ? "bg-black" : "bg-bg-primary"
			}`}
			data-testid="paper-starfield"
			onClick={handleClick}
			onPointerLeave={handlePointerLeave}
			onPointerMove={handlePointerMove}
			ref={containerRef}
		>
			<canvas aria-hidden="true" className="h-full w-full" ref={canvasRef} />
			<div
				className={`pointer-events-none absolute inset-0 ${
					colorMode === "dark"
						? "bg-[radial-gradient(circle_at_center,transparent_0%,rgb(0_0_0_/_0.34)_46%,rgb(0_0_0)_100%)]"
						: "bg-[radial-gradient(circle_at_center,transparent_0%,rgb(255_255_255_/_0.16)_48%,rgb(255_255_255_/_0.42)_100%)]"
				}`}
			/>
			{hovered ? (
				<div
					className={`pointer-events-none absolute max-w-72 rounded-lg border px-3 py-2 shadow-[0_16px_50px_rgb(0_0_0_/_0.18)] backdrop-blur-md ${
						colorMode === "dark"
							? "border-white/20 bg-black/62 text-white"
							: "border-border-subtle bg-bg-overlay text-text-primary"
					}`}
					style={{
						left: `${Math.min(hovered.x + 18, window.innerWidth - 320)}px`,
						top: `${Math.max(hovered.y - 36, 24)}px`,
					}}
				>
					<div className="line-clamp-2 text-sm font-medium leading-5">{hovered.item.title}</div>
					<div
						className={`mt-1 truncate text-xs ${
							colorMode === "dark" ? "text-white/58" : "text-text-tertiary"
						}`}
					>
						{paperMetaLine(hovered.item) || "Paper"}
					</div>
				</div>
			) : null}
		</div>
	)
}

function buildParticles(items: PaperStarItem[]) {
	const particles: Particle[] = []
	const totalCount = AMBIENT_PARTICLE_COUNT + MAX_INTERACTIVE_STARS
	for (let index = 0; index < totalCount; index += 1) {
		const item = index < items.length ? items[index] : null
		const seed = Math.random() * 10000 + index + 1
		const spawn = randomSpawnPosition(-FIELD_DEPTH + randomRange(0, FIELD_DEPTH))
		particles.push({
			x: spawn.x,
			y: spawn.y,
			z: spawn.z,
			intensity: intensityForSeed(item ? seed * 11.2 : seed * 12.5, Boolean(item)),
			angularSpeed: randomAngularSpeed(),
			curvePhase: randomRange(0, Math.PI * 2),
			curveRadius: randomCurveRadius(Boolean(item)),
			curveSpeed: randomCurveSpeed(),
			size: sizeForSeed(item ? seed * 7.9 : seed * 8.3, Boolean(item)),
			speed: speedForSeed(item ? seed * 5.9 : seed * 6.7, Boolean(item)),
			trail: trailForSeed(item ? seed * 9.1 : seed * 10.4, Boolean(item)),
			item,
		})
	}
	return particles
}

function syncParticleItems(
	particles: Particle[],
	paperMeshes: any[],
	items: PaperStarItem[],
) {
	for (let index = 0; index < Math.min(MAX_INTERACTIVE_STARS, particles.length); index += 1) {
		const item = items[index] ?? null
		const particle = particles[index]
		particle.item = item
		const mesh = paperMeshes[index]
		if (mesh) {
			mesh.userData.item = item
			mesh.userData.particle = particle
			mesh.visible = Boolean(item)
		}
	}
	for (let index = Math.min(MAX_INTERACTIVE_STARS, particles.length); index < particles.length; index += 1) {
		particles[index].item = null
	}
}

function randomRange(min: number, max: number) {
	return min + Math.random() * (max - min)
}

function randomSpawnPosition(z: number) {
	const angle = randomRange(0, Math.PI * 2)
	const radius = Math.pow(Math.random(), 0.58)
	const horizontalStretch = randomRange(0.56, 1.08)
	const verticalStretch = randomRange(0.56, 1.14)
	const centerBias = Math.random() > 0.72 ? randomRange(0.08, 0.42) : 1
	return {
		x: Math.cos(angle) * radius * FIELD_WIDTH * 0.5 * horizontalStretch * centerBias,
		y: Math.sin(angle) * radius * FIELD_HEIGHT * 0.5 * verticalStretch * centerBias,
		z,
	}
}

function rotateParticle(particle: Particle, angle: number) {
	if (Math.abs(angle) < 0.000001) return
	const nextX = particle.x * Math.cos(angle) - particle.y * Math.sin(angle)
	const nextY = particle.x * Math.sin(angle) + particle.y * Math.cos(angle)
	particle.x = nextX
	particle.y = nextY
}

function seededNoise(value: number) {
	const x = Math.sin(value * 12.9898) * 43758.5453
	return x - Math.floor(x)
}

function speedForSeed(seed: number, isInteractive: boolean) {
	const base = seededNoise(seed)
	const burst = seededNoise(seed + 31.7) > 0.78 ? seededNoise(seed + 41.2) * 0.14 : 0
	const slowDrift = seededNoise(seed + 51.6) > 0.72 ? -seededNoise(seed + 61.4) * 0.012 : 0
	return Math.max(0.01, (isInteractive ? 0.018 : 0.012) + base * 0.095 + burst + slowDrift)
}

function sizeForSeed(seed: number, isInteractive: boolean) {
	const base = seededNoise(seed)
	const largeBurst = seededNoise(seed + 17.4) > 0.9 ? seededNoise(seed + 22.9) * 5 : 0
	return (isInteractive ? 8 : 5) + base * 7 + largeBurst
}

function trailForSeed(seed: number, isInteractive: boolean) {
	const base = seededNoise(seed)
	const longBurst = seededNoise(seed + 9.7) > 0.72 ? seededNoise(seed + 12.1) * 46 : 0
	return (isInteractive ? 42 : 34) + base * 58 + longBurst
}

function intensityForSeed(seed: number, isInteractive: boolean) {
	const base = seededNoise(seed)
	return (isInteractive ? 0.64 : 0.38) + base * 0.22
}

function randomAngularSpeed() {
	const direction = Math.random() > 0.5 ? 1 : -1
	const stillness = Math.random() > 0.82 ? 0.34 : 1
	return direction * randomRange(0.00022, 0.0019) * stillness
}

function randomCurveRadius(isInteractive: boolean) {
	const base = isInteractive ? 0.34 : 0.22
	return base + Math.pow(Math.random(), 0.52) * randomRange(0.45, 1.35)
}

function randomCurveSpeed() {
	return randomRange(0.26, 1.65)
}

function writeParticleTrail({
	elapsedSeconds,
	index,
	intensities,
	isInteractive,
	particle,
	positions,
	pulse,
	sizes,
}: {
	elapsedSeconds: number
	index: number
	intensities: any
	isInteractive: boolean
	particle: Particle
	positions: any
	pulse: number
	sizes: any
}) {
	const radialScale = Math.max(1, Math.hypot(particle.x, particle.y))
	for (let sample = 0; sample < TRAIL_SAMPLES; sample += 1) {
		const t = sample / (TRAIL_SAMPLES - 1)
		const falloff = Math.pow(1 - t, 1.08)
		const sampleIndex = index * TRAIL_SAMPLES + sample
		const z = particle.z - particle.trail * t
		const spread = 1 + t * 0.055
		const backtrackAngle = particle.angularSpeed * particle.trail * t * 0.82
		const arcX = particle.x * Math.cos(backtrackAngle) - particle.y * Math.sin(backtrackAngle)
		const arcY = particle.x * Math.sin(backtrackAngle) + particle.y * Math.cos(backtrackAngle)
		const curveWave =
			Math.sin(elapsedSeconds * particle.curveSpeed + particle.curvePhase + t * Math.PI * 1.35) *
			particle.curveRadius *
			t *
			1.25
		const curveCross =
			Math.cos(elapsedSeconds * particle.curveSpeed * 0.72 + particle.curvePhase + t * Math.PI) *
			particle.curveRadius *
			t *
			0.72
		const headFactor = sample === 0 ? 0.62 : 1
		const trailFactor = sample === 0 ? 0.46 : 0.78 - t * 0.38
		const intensityFactor = sample === 0 ? 0.74 : 0.38
		positions.setXYZ(sampleIndex, arcX * spread + curveWave, arcY * spread + curveCross, z)
		sizes.setX(
			sampleIndex,
			particle.size * headFactor * Math.max(0.22, trailFactor) * (isInteractive ? 1.12 : 1),
		)
		intensities.setX(
			sampleIndex,
			particle.intensity *
				falloff *
				intensityFactor *
				(isInteractive ? pulse : 1) *
				(0.88 + radialScale * 0.0015),
		)
	}
}

function paperMetaLine(item: PaperStarItem) {
	return [item.year, item.venue].filter(Boolean).join(" · ")
}
