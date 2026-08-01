import { useEffect, useRef } from "react";
import * as THREE from "three";

const GLASS_COLORS = [0x6d5bf7, 0xa855f7, 0x22d3ee, 0xf472b6, 0x818cf8];

function glassMaterial(color: number) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.1,
    roughness: 0.15,
    transmission: 0.85,
    transparent: true,
    opacity: 0.85,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
}

/** Dashboard-themed WebGL background for the login screen: floating glassy bar-chart
 *  clusters, a glowing upward trend line with pulsing data-point nodes, and donut-chart
 *  rings, spread across the full viewport (not just behind the card) with a subtle
 *  mouse-driven camera parallax. Purely decorative -- renders nothing but a full-bleed
 *  canvas, so it's safe to drop in anywhere. */
export default function LoginBackground3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.z = 10;

    scene.add(new THREE.AmbientLight(0x8888ff, 0.5));
    const light1 = new THREE.PointLight(0x8b5cf6, 4, 30);
    light1.position.set(-7, 4, 4);
    scene.add(light1);
    const light2 = new THREE.PointLight(0x22d3ee, 4, 30);
    light2.position.set(7, -4, 4);
    scene.add(light2);
    const light3 = new THREE.PointLight(0xf472b6, 3, 30);
    light3.position.set(0, 5, -2);
    scene.add(light3);
    const light4 = new THREE.PointLight(0xa855f7, 2.5, 30);
    light4.position.set(-5, -4, 2);
    scene.add(light4);

    const disposables: Array<{ dispose: () => void }> = [];
    const bars: THREE.Mesh[] = [];

    function makeBarCluster(centerX: number, centerY: number, centerZ: number, heights: number[]) {
      const group = new THREE.Group();
      const spacing = 0.55;
      const startX = -((heights.length - 1) * spacing) / 2;
      heights.forEach((h, i) => {
        const geo = new THREE.BoxGeometry(0.36, h, 0.36);
        const mat = glassMaterial(GLASS_COLORS[i % GLASS_COLORS.length]);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(startX + i * spacing, h / 2, 0);
        mesh.userData = { baseY: h / 2, phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random() * 0.3 };
        group.add(mesh);
        bars.push(mesh);
        disposables.push(geo, mat);
      });
      group.position.set(centerX, centerY, centerZ);
      scene.add(group);
    }
    makeBarCluster(-7.6, -2.7, -2, [0.9, 1.6, 1.1]);
    makeBarCluster(7.3, -3.0, -1.5, [1.3, 0.7, 1.8]);
    makeBarCluster(-6.9, 3.6, -3, [0.6, 1.0]);
    makeBarCluster(6.6, 3.3, -2.8, [0.8, 1.2, 0.6]);

    const pathPoints = [
      new THREE.Vector3(-7.4, -2.2, 1.5),
      new THREE.Vector3(-5.0, -1.0, 1.2),
      new THREE.Vector3(-2.6, -1.7, 1.6),
      new THREE.Vector3(0, 0.3, 1.2),
      new THREE.Vector3(2.6, -0.4, 1.6),
      new THREE.Vector3(5.0, 1.2, 1.1),
      new THREE.Vector3(7.4, 2.4, 1.4),
    ];
    const curve = new THREE.CatmullRomCurve3(pathPoints);
    const tubeGeo = new THREE.TubeGeometry(curve, 80, 0.035, 8, false);
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.9, roughness: 0.3 });
    scene.add(new THREE.Mesh(tubeGeo, tubeMat));
    disposables.push(tubeGeo, tubeMat);

    const nodes: THREE.Mesh[] = [];
    pathPoints.forEach((p) => {
      const nodeGeo = new THREE.SphereGeometry(0.09, 16, 16);
      const nodeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x8b5cf6, emissiveIntensity: 1.3 });
      const node = new THREE.Mesh(nodeGeo, nodeMat);
      node.position.copy(p);
      node.userData = { phase: Math.random() * Math.PI * 2 };
      scene.add(node);
      nodes.push(node);
      disposables.push(nodeGeo, nodeMat);
    });

    const donutGeo = new THREE.TorusGeometry(0.9, 0.27, 20, 48);
    const donutMat = glassMaterial(0xa855f7);
    const donut = new THREE.Mesh(donutGeo, donutMat);
    donut.position.set(0.2, 3.9, -3);
    donut.rotation.x = Math.PI / 2.4;
    scene.add(donut);
    disposables.push(donutGeo, donutMat);

    const donut2Geo = new THREE.TorusGeometry(0.55, 0.18, 20, 40);
    const donut2Mat = glassMaterial(0x22d3ee);
    const donut2 = new THREE.Mesh(donut2Geo, donut2Mat);
    donut2.position.set(-5.2, -4.0, -1);
    donut2.rotation.x = Math.PI / 3;
    scene.add(donut2);
    disposables.push(donut2Geo, donut2Mat);

    const ambientNodes: THREE.Mesh[] = [];
    for (let i = 0; i < 22; i++) {
      const geo = new THREE.SphereGeometry(0.045 + Math.random() * 0.05, 12, 12);
      const color = GLASS_COLORS[i % GLASS_COLORS.length];
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.1 });
      const node = new THREE.Mesh(geo, mat);
      node.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 5 - 1);
      node.userData = { baseY: node.position.y, phase: Math.random() * Math.PI * 2, speed: 0.2 + Math.random() * 0.3 };
      scene.add(node);
      ambientNodes.push(node);
      disposables.push(geo, mat);
    }

    let targetCamX = 0;
    let targetCamY = 0;
    function handleMouseMove(e: MouseEvent) {
      const px = e.clientX / window.innerWidth;
      const py = e.clientY / window.innerHeight;
      targetCamX = (px - 0.5) * -1.4;
      targetCamY = (py - 0.5) * 1.0;
    }
    function handleMouseLeave() {
      targetCamX = 0;
      targetCamY = 0;
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);

    function handleResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener("resize", handleResize);

    const clock = new THREE.Clock();
    let frameId: number;
    function animate() {
      frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      bars.forEach((bar) => {
        bar.position.y = bar.userData.baseY + Math.sin(t * bar.userData.speed + bar.userData.phase) * 0.06;
        bar.rotation.y += 0.003;
      });
      nodes.forEach((node) => {
        const s = 1 + Math.sin(t * 1.6 + node.userData.phase) * 0.25;
        node.scale.set(s, s, s);
      });
      ambientNodes.forEach((node) => {
        node.position.y = node.userData.baseY + Math.sin(t * node.userData.speed + node.userData.phase) * 0.3;
        const s = 1 + Math.sin(t * 1.2 + node.userData.phase) * 0.35;
        node.scale.set(s, s, s);
      });
      donut.rotation.z += 0.004;
      donut2.rotation.z -= 0.003;

      camera.position.x += (Math.sin(t * 0.04) * 0.8 + targetCamX - camera.position.x) * 0.04;
      camera.position.y += (targetCamY - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("resize", handleResize);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="login-bg-canvas" />;
}
