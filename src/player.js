import * as THREE from '../lib/three/three.js';
import { GLTFLoader } from '../lib/three/GLTFLoader.js';

class GlbViewer extends HTMLElement {
  static get observedAttributes() {
    return ['model', 'base-url', 'width', 'height'];
  }

  constructor() {
    super();
    this.baseUrl = '';
    this.model = '';
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.loader = new GLTFLoader();
    this.animationId = null;
    this.container = null;

    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          background: #3a4d63;
          border-radius: 6px;
          overflow: hidden;
        }
        canvas {
          width: 100% !important;
          height: 100% !important;
          display: block;
        }
        .btn {
          position: absolute;
          top: 8px;
          background: rgba(0,0,0,0.5);
          border: none;
          color: #00d8ff;
          font-size: 18px;
          cursor: pointer;
          border-radius: 4px;
          width: 30px;
          height: 30px;
          line-height: 28px;
          text-align: center;
        }
        #close-btn { right: 8px; }
        #fullscreen-btn { right: 100px; }
        #download-btn { right: 46px; }
      </style>
      <button class="btn" id="fullscreen-btn" title="Toggle Fullscreen" style="display:none">⤢</button>
      <button class="btn" id="close-btn" title="Hide Viewer">✖</button>
      <a class="btn" target="_blank" id="download-btn" title="Download Model" data-download="">⬇</button>
    `;
  }

  connectedCallback() {
    this.container = document.createElement('div');
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.shadowRoot.appendChild(this.container);

    this.updateSize();
    this.initThree();
    this.loadModel();

    this.shadowRoot.getElementById('fullscreen-btn').addEventListener('click', () => this.toggleFullscreen());
    this.shadowRoot.getElementById('close-btn').addEventListener('click', () => this.style.display = "none");


    window.addEventListener('resize', () => this.onWindowResize());
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.animationId);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.context = null;
      this.renderer.domElement = null;
      this.renderer = null;
    }
    window.removeEventListener('resize', this.onWindowResize);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    if (name === 'model') {
      this.model = newValue;
      this.loadModel();
    } else if (name === 'base-url') {
      this.baseUrl = newValue;
      this.loadModel();
    } else if (name === 'width' || name === 'height') {
      this.updateSize();
    }
  }

  updateSize() {
    const width = this.getAttribute('width') || '400';
    const height = this.getAttribute('height') || '250';

    this.style.width = `${width}px`;
    this.style.height = `${height}px`;

    if (this.renderer) {
      this.renderer.setSize(parseInt(width), parseInt(height));
    }
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  initThree() {
    this.scene = new THREE.Scene();

    const width = this.clientWidth || parseInt(this.getAttribute('width')) || 400;
    const height = this.clientHeight || parseInt(this.getAttribute('height')) || 250;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(0, 2, 5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.container.appendChild(this.renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    this.scene.add(directionalLight);

    this.controls = null; // Optional: add OrbitControls if needed

    this.animate();
  }

  loadModel() {
    if (!this.model || !this.renderer) return;

    this.scene.children = this.scene.children.filter(obj => obj.type === 'AmbientLight' || obj.type === 'DirectionalLight');

    const url = this.baseUrl ? this.baseUrl.replace(/\/$/, '') + '/' + this.model : this.model;
    this.shadowRoot.getElementById('download-btn').setAttribute("href",url)
      this.shadowRoot.getElementById('download-btn').setAttribute("data-download",url)

    this.loader.load(
      url,
      gltf => {
        this.modelScene = gltf.scene;
        this.scene.add(this.modelScene);

        this.fitCameraToObject(this.camera, this.modelScene, 2);

        this.render();
        this.dispatchEvent(new Event('load'));
      },
      undefined,
      error => {
        console.error('Error loading GLB:', error);
        this.dispatchEvent(new Event('error', error));
      }
    );
  }

  fitCameraToObject(camera, object, offset = 1.25) {
    const boundingBox = new THREE.Box3().setFromObject(object);

    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * offset;

    camera.position.set(center.x, center.y, cameraZ);

    const minZ = boundingBox.min.z;
    const cameraToFarEdge = minZ < 0 ? -minZ + cameraZ : cameraZ - minZ;

    camera.far = cameraToFarEdge * 3;
    camera.updateProjectionMatrix();

    if (this.controls) {
      this.controls.target.copy(center);
      this.controls.update();
    } else {
      camera.lookAt(center);
    }
  }

  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    if (this.modelScene) {
      this.modelScene.rotation.y += 0.01; // auto rotate
    }

    this.render();
  }

  render() {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.shadowRoot.host.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  onWindowResize() {
    this.updateSize();
  }
}

customElements.define('glb-viewer', GlbViewer);
