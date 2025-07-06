// ==UserScript==
// @name         Krunker.IO Aimbot & ESP [AD FREE]
// @namespace    http://tampermonkey.net/
// @version      0.3.8
// @description  Locks aim to the nearest player in krunker.io with team-based targeting, optional FOV-based targeting, team-based colored ESP lines and boxes, and wall check for aimbot.
// @author       j-bond007
// @match        *://krunker.io/*
// @match        *://browserfps.com/*
// @exclude      *://krunker.io/social*
// @exclude      *://krunker.io/editor*
// @icon         https://www.google.com/s2/favicons?domain=krunker.io
// @grant        none
// @run-at       document-start
// @require      https://unpkg.com/three@0.150.0/build/three.min.js
// @downloadURL https://update.greasyfork.org/scripts/432453/KrunkerIO%20Aimbot%20%20ESP.user.js
// @updateURL https://update.greasyfork.org/scripts/432453/KrunkerIO%20Aimbot%20%20ESP.meta.js
// ==/UserScript==
const THREE = window.THREE;
delete window.THREE;
const shouldShowAd = false;
removeQueries();

const defaultSettings = {
	aimbotEnabled: true,
	aimbotOnRightMouse: false,
	aimbotWallCheck: true, 
	espEnabled: true,
	espLines: true,
	wireframe: false,
	fovSort: false,
	fovAngle: 60 
};
const settings = Object.assign({}, defaultSettings);
try {
	const savedSettings = JSON.parse(localStorage.getItem('krunkerAimbotSettings') || '{}');
	for (const key in defaultSettings) {
		if (savedSettings[key] !== undefined) {
			settings[key] = savedSettings[key];
		}
	}
} catch (e) {
	console.log('Error loading settings:', e);
}

const keyToSetting = {
	KeyB: 'aimbotEnabled',
	KeyL: 'aimbotOnRightMouse',
	KeyM: 'espEnabled',
	KeyN: 'espLines',
	KeyK: 'wireframe',
	KeyO: 'fovSort'
};

const gui = createGUI();

let scene;
let rightMouseDown = false;
let targetPlayer = null; 
let intersectableObjects = []; 
let visibilityCache = new Map(); 
let lastVisibilityCheck = 0; 
const VISIBILITY_CHECK_INTERVAL = 100; 

const x = {
	window: window,
	document: document,
	querySelector: document.querySelector,
	consoleLog: console.log,
	ReflectApply: Reflect.apply,
	ArrayPrototype: Array.prototype,
	ArrayPush: Array.prototype.push,
	ObjectPrototype: Object.prototype,
	clearInterval: window.clearInterval,
	setTimeout: window.setTimeout,
	reToString: RegExp.prototype.toString,
	indexOf: String.prototype.indexOf,
	requestAnimationFrame: window.requestAnimationFrame
};

x.consoleLog('Waiting to inject...');

const proxied = function (object) {
	try {
		if (typeof object === 'object' &&
			typeof object.parent === 'object' &&
			object.parent.type === 'Scene' &&
			object.parent.name === 'Main') {
			x.consoleLog('Found Scene!');
			scene = object.parent;

			updateIntersectableObjects();
			x.ArrayPrototype.push = x.ArrayPush;
		}
	} catch (error) {}
	return x.ArrayPush.apply(this, arguments);
};

function updateIntersectableObjects() {
	if (!scene || !scene.children) return;
	const startTime = performance.now();
	intersectableObjects = scene.children.filter(obj => {
		if (obj.type !== 'Mesh' || !obj.visible) return false;
		if (obj.geometry) {
			if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
			const size = obj.geometry.boundingBox.getSize(new THREE.Vector3());
			return size.y > 15 && (size.x > 15 || size.z > 15); 
		}
		return false;
	});
	x.consoleLog(`Updated intersectable objects: ${intersectableObjects.length}, took ${performance.now() - startTime}ms`);
}

function isPlayerVisible(player, myPlayer, scene, THREE) {
	if (!settings.aimbotWallCheck) {
		return true; 
	}

	if (!player.children[0] || !player.children[0].children[0] || !myPlayer.children[0] || !myPlayer.children[0].children[0]) {
		return false; 
	}

	const now = performance.now();
	const playerId = player.uuid || player.id || JSON.stringify(player.position); 
	const cached = visibilityCache.get(playerId);
	if (cached && now - cached.timestamp < VISIBILITY_CHECK_INTERVAL) {
		return cached.visible;
	}

	const startTime = performance.now();
	const camera = myPlayer.children[0].children[0];
	const targetPos = new THREE.Vector3();
	player.children[0].children[0].getWorldPosition(targetPos); 

	const cameraPos = new THREE.Vector3();
	camera.getWorldPosition(cameraPos);

	const direction = targetPos.clone().sub(cameraPos).normalize();
	const raycaster = new THREE.Raycaster();
	raycaster.set(cameraPos, direction);

	const objectsToIntersect = intersectableObjects.filter(obj => obj.id !== player.id);
	const intersects = raycaster.intersectObjects(objectsToIntersect, false);

	let visible = true;
	if (intersects.length > 0) {
		const distanceToPlayer = cameraPos.distanceTo(targetPos);
		if (intersects[0].distance < distanceToPlayer - 1) {
			const hitObject = intersects[0].object;
			if (hitObject.geometry) {
				if (!hitObject.geometry.boundingBox) hitObject.geometry.computeBoundingBox();
				const size = hitObject.geometry.boundingBox.getSize(new THREE.Vector3());
				if (size.y > 15 && (size.x > 15 || size.z > 15)) {
					visible = false; 
				}
			} else {
				visible = false; 
			}
		}
	}

	visibilityCache.set(playerId, { visible, timestamp: now });
	x.consoleLog(`Visibility check for player ${playerId}: ${visible}, took ${performance.now() - startTime}ms`);

	return visible;
}

const tempVector = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();
const tempObject = new THREE.Object3D();
tempObject.rotation.order = 'YXZ';

const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(5, 15, 5).translate(0, 7.5, 0));

const linePositions = new THREE.BufferAttribute(new Float32Array(100 * 2 * 3), 3);
const lineColors = new THREE.BufferAttribute(new Float32Array(100 * 2 * 3), 3);

const material = new THREE.RawShaderMaterial({
	vertexShader: `
		attribute vec3 position;
		attribute vec3 color;
		uniform mat4 projectionMatrix;
		uniform mat4 modelViewMatrix;
		varying vec3 vColor;
		void main() {
			vColor = color;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			gl_Position.z = 1.0;
		}
	`,
	fragmentShader: `
		varying vec3 vColor;
		void main() {
			gl_FragColor = vec4(vColor, 1.0);
		}
	`
});

const line = new THREE.LineSegments(new THREE.BufferGeometry(), material);
line.geometry.setAttribute('position', linePositions);
line.geometry.setAttribute('color', lineColors);
line.frustumCulled = false;

const canvas = document.createElement('canvas');
canvas.style.position = 'absolute';
canvas.style.top = '0';
canvas.style.left = '0';
canvas.style.pointerEvents = 'none';
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const ctx = canvas.getContext('2d');

function drawFovCircle() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	if (!settings.fovSort) return;

	const centerX = canvas.width / 2;
	const centerY = canvas.height / 2;
	const fovRadius = (settings.fovAngle / 90) * (canvas.height / 4); 

	ctx.beginPath();
	ctx.arc(centerX, centerY, fovRadius, 0, 2 * Math.PI);
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
	ctx.lineWidth = 2;
	ctx.stroke();
}

window.addEventListener('resize', () => {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	drawFovCircle();
});

let injectTimer = null;

function animate() {
	x.requestAnimationFrame.call(x.window, animate);
	drawFovCircle();

	if (!scene && !injectTimer) {
		const el = x.querySelector.call(x.document, '#loadingBg');
		if (el && el.style.display === 'none') {
			x.consoleLog('Inject timer started!');
			injectTimer = x.setTimeout.call(x.window, () => {
				x.consoleLog('Injected!');
				x.ArrayPrototype.push = proxied;
			}, 2e3);
		}
	}

	if (typeof shouldShowAd === 'undefined' || scene === undefined || !scene.children) {
		return;
	}

	const now = performance.now();
	if (now - lastVisibilityCheck > VISIBILITY_CHECK_INTERVAL) {
		visibilityCache.clear(); 
		lastVisibilityCheck = now;
	}

	const players = [];
	let myPlayer;

	for (let i = 0; i < scene.children.length; i++) {
		const child = scene.children[i];
		if (child.type === 'Object3D') {
			try {
				if (child.children[0].children[0].type === 'PerspectiveCamera') {
					myPlayer = child;
				} else {
					players.push(child);
				}
			} catch (err) {}
		} else if (child.material) {
			child.material.wireframe = settings.wireframe;
		}
	}

	if (!myPlayer) {
		x.consoleLog('Player not found, finding new scene.');
		x.ArrayPrototype.push = proxied;
		return;
	}

	let counter = 0;
	targetPlayer = null; 
	let minDistance = Infinity;
	let minAngle = Infinity;

	const myTeam = myPlayer.teamName || 'unknown';
	const camera = myPlayer.children[0].children[0];
	const cameraDirection = new THREE.Vector3();
	camera.getWorldDirection(cameraDirection);

	tempObject.matrix.copy(myPlayer.matrix).invert();

	const startTime = performance.now();

	const sortedPlayers = settings.fovSort
		? players.sort((a, b) => {
			const aPos = new THREE.Vector3().copy(a.position).sub(myPlayer.position).normalize();
			const bPos = new THREE.Vector3().copy(b.position).sub(myPlayer.position).normalize();
			const angleA = cameraDirection.angleTo(aPos) * (180 / Math.PI);
			const angleB = cameraDirection.angleTo(bPos) * (180 / Math.PI);
			return angleA - angleB;
		})
		: players.sort((a, b) => myPlayer.position.distanceTo(a.position) - myPlayer.position.distanceTo(b.position));

	for (let i = 0; i < sortedPlayers.length; i++) {
		const player = sortedPlayers[i];
		if (!player.children[0]) continue; 
		const teamName = player.teamName || 'unknown';
		const isAlly = teamName === myTeam && teamName !== 'unknown';
		const teamColor = isAlly ? [0, 1, 0] : [1, 0, 0]; 

		if (!player.box) {
			const boxMaterial = new THREE.RawShaderMaterial({
				vertexShader: `
					attribute vec3 position;
					uniform mat4 projectionMatrix;
					uniform mat4 modelViewMatrix;
					void main() {
						gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
						gl_Position.z = 1.0;
					}
				`,
				fragmentShader: `
					void main() {
						gl_FragColor = vec4(${teamColor[0]}, ${teamColor[1]}, ${teamColor[2]}, 1.0);
					}
				`
			});
			const box = new THREE.LineSegments(geometry, boxMaterial);
			box.frustumCulled = false;
			player.add(box);
			player.box = box;
		}

		if (player.position.x === myPlayer.position.x && player.position.z === myPlayer.position.z) {
			player.box.visible = false;
			if (line.parent !== player) {
				player.add(line);
			}
			continue;
		}

		linePositions.setXYZ(counter, 0, 10, -5);
		lineColors.setXYZ(counter, teamColor[0], teamColor[1], teamColor[2]);
		counter++;

		tempVector.copy(player.position);
		tempVector.y += 9;
		tempVector.applyMatrix4(tempObject.matrix);

		linePositions.setXYZ(counter, tempVector.x, tempVector.y, tempVector.z);
		lineColors.setXYZ(counter, teamColor[0], teamColor[1], teamColor[2]);
		counter++;

		player.visible = settings.espEnabled || player.visible;
		player.box.visible = settings.espEnabled;

		if (!isAlly && !targetPlayer && (settings.fovSort ? i === 0 : true)) {
			const distance = player.position.distanceTo(myPlayer.position);
			const angle = settings.fovSort ? cameraDirection.angleTo(tempVector2.copy(player.position).sub(myPlayer.position).normalize()) * (180 / Math.PI) : 0;
			if (!settings.fovSort || angle < settings.fovAngle) {
				if (isPlayerVisible(player, myPlayer, scene, THREE)) {
					targetPlayer = player;
					minDistance = distance;
					minAngle = angle;
				}
			}
		}
	}
	x.consoleLog(`Player processing took ${performance.now() - startTime}ms`);

	linePositions.needsUpdate = true;
	lineColors.needsUpdate = true;
	line.geometry.setDrawRange(0, counter);
	line.visible = settings.espLines;

	if (settings.aimbotEnabled && (!settings.aimbotOnRightMouse || rightMouseDown) && targetPlayer) {
		tempVector.setScalar(0);
		targetPlayer.children[0].children[0].localToWorld(tempVector);
		tempObject.position.copy(myPlayer.position);
		tempObject.lookAt(tempVector);
		myPlayer.children[0].rotation.x = -tempObject.rotation.x;
		myPlayer.rotation.y = tempObject.rotation.y + Math.PI;
	}
}

const el = document.createElement('div');
el.innerHTML = `<style>
.msg {
	position: absolute;
	left: 10px;
	bottom: 10px;
	color: #fff;
	background: rgba(0, 0, 0, 0.6);
	font-weight: bolder;
	padding: 15px;
	animation: msg 0.5s forwards, msg 0.5s reverse forwards 3s;
	z-index: 999999;
	pointer-events: none;
}
@keyframes msg {
	from {
		transform: translate(-120%, 0);
	}
	to {
		transform: none;
	}
}
.zui {
	position: fixed;
	right: 10px;
	top: 0;
	z-index: 999;
	display: flex;
	flex-direction: column;
	font-family: monospace;
	font-size: 14px;
	color: #fff;
	width: 250px;
	user-select: none;
	border: 2px solid #000;
}
.zui-item {
	padding: 5px 8px;
	display: flex;
	justify-content: space-between;
	align-items: center;
	background: #222;
	cursor: pointer;
}
.zui-item.text {
	justify-content: center;
	cursor: unset;
	text-align: center;
	background: #333;
}
.zui-item:hover {
	background: #333;
}
.zui-item span {
	color: #fff;
	font-family: monospace;
	font-size: 14px;
}
.zui-header {
	background: #000;
}
.zui-header span {
	font-size: 16px;
}
.zui-header:hover {
	background: #000;
}
.zui-on {
	color: green;
}
.zui-item-value {
	font-size: 0.8em;
}
.zui-content .zui-item-value {
	font-weight: bolder;
}
.zui-slider {
	width: 100%;
}
</style>
<div class="msg" style="display: none;"></div>`;

const msgEl = el.querySelector('.msg');

window.addEventListener('DOMContentLoaded', function () {
	while (el.children.length > 0) {
		document.body.appendChild(el.children[0]);
	}
	document.body.appendChild(gui);
	document.body.appendChild(canvas);
});

function removeQueries() {
	const url = new URL(window.location.href);
	url.searchParams.delete('showAd');
	url.searchParams.delete('scriptVersion');
	window.history.pushState(null, '', url.href);
}

function handleMouse(event) {
	if (event.button === 2) {
		rightMouseDown = event.type === 'pointerdown';
		if (!rightMouseDown) {
			targetPlayer = null; 
		}
	}
}

window.addEventListener('pointerdown', handleMouse);
window.addEventListener('pointerup', handleMouse);

window.addEventListener('keyup', function (event) {
	if (x.document.activeElement && x.document.activeElement.value !== undefined) return;
	if (keyToSetting[event.code]) {
		toggleSetting(keyToSetting[event.code]);
	}
	switch (event.code) {
		case 'Slash':
			toggleElementVisibility(gui);
			break;
	}
});

function toggleElementVisibility(el) {
	el.style.display = el.style.display === '' ? 'none' : '';
}

function showMsg(name, bool) {
	msgEl.innerText = name + ': ' + (bool ? 'ON' : 'OFF');
	msgEl.style.display = 'none';
	void msgEl.offsetWidth;
	msgEl.style.display = '';
}

function saveSettings() {
	try {
		localStorage.setItem('krunkerAimbotSettings', JSON.stringify(settings));
	} catch (e) {
		console.log('Error saving settings:', e);
	}
}

animate();

function createGUI() {
	const guiEl = fromHtml(`<div class="zui">
		<div class="zui-item zui-header">
			<span>[/] Controls</span>
			<span class="zui-item-value">[close]</span>
		</div>
		<div class="zui-content"></div>
	</div>`);

	const headerEl = guiEl.querySelector('.zui-header');
	const contentEl = guiEl.querySelector('.zui-content');
	const headerStatusEl = guiEl.querySelector('.zui-item-value');

	headerEl.onclick = function () {
		const isHidden = contentEl.style.display === 'none';
		contentEl.style.display = isHidden ? '' : 'none';
		headerStatusEl.innerText = isHidden ? '[close]' : '[open]';
	};

	const settingToKey = {};
	for (const key in keyToSetting) {
		settingToKey[keyToSetting[key]] = key;
	}

	const guiElements = {}; 

	for (const prop in settings) {
		if (prop === 'fovAngle') {
			const itemEl = fromHtml(`<div class="zui-item">
				<span>FOV Angle: <span class="zui-item-value">${settings.fovAngle}°</span></span>
				<input type="range" min="10" max="180" value="${settings.fovAngle}" class="zui-slider">
			</div>`);
			const valueEl = itemEl.querySelector('.zui-item-value');
			const slider = itemEl.querySelector('.zui-slider');

			function updateValueEl() {
				valueEl.innerText = `${settings.fovAngle}°`;
				slider.value = settings.fovAngle; 
			}

			slider.oninput = function () {
				settings.fovAngle = parseInt(this.value);
				updateValueEl();
				drawFovCircle(); 
				saveSettings();
			};

			guiElements[prop] = { valueEl, updateValueEl };
			contentEl.appendChild(itemEl);
		} else {
			let name = fromCamel(prop);
			let shortKey = settingToKey[prop];
			if (shortKey) {
				if (shortKey.startsWith('Key')) shortKey = shortKey.slice(3);
				name = `[${shortKey}] ${name}`;
			}
			const itemEl = fromHtml(`<div class="zui-item">
				<span>${name}</span>
				<span class="zui-item-value"></span>
			</div>`);
			const valueEl = itemEl.querySelector('.zui-item-value');

			function updateValueEl() {
				const value = settings[prop];
				valueEl.innerText = value ? 'ON' : 'OFF';
				valueEl.style.color = value ? 'blue' : 'pink';
			}
			itemEl.onclick = function () {
				settings[prop] = !settings[prop];
				updateValueEl();
				showMsg(fromCamel(prop), settings[prop]);
				saveSettings();
			};
			updateValueEl();
			guiElements[prop] = { valueEl, updateValueEl };
			contentEl.appendChild(itemEl);
		}

		const p = `__${prop}`;
		settings[p] = settings[prop];
		Object.defineProperty(settings, prop, {
			get() {
				return this[p];
			},
			set(value) {
				this[p] = value;
				if (guiElements[prop]) {
					guiElements[prop].updateValueEl();
				}
				if (prop === 'fovSort' || prop === 'fovAngle') {
					drawFovCircle(); 
				}
				saveSettings();
			}
		});
	}

	contentEl.appendChild(fromHtml(`<div class="zui-item text">
		<span>AD FREE by j-bond007!</span>
	</div>`));

	return guiEl;
}

function fromCamel(text) {
	const result = text.replace(/([A-Z])/g, ' $1');
	return result.charAt(0).toUpperCase() + result.slice(1);
}

function fromHtml(html) {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div.children[0];
}

function toggleSetting(key) {
	settings[key] = !settings[key];
	showMsg(fromCamel(key), settings[key]);
}
