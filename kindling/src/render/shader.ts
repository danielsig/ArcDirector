import * as THREE from 'three';

export type ShaderInsert = {
	id:string;
	/** Public Three.js chunk name, e.g. `color_fragment` or `common`. */
	chunk:string;
	glsl:string;
};

export type ShaderUniforms = Record<string, THREE.IUniform>;

/** Insert `glsl` immediately after `#include <chunk>`. Throws if the token is missing. */
export function insertAfterChunk(shader:string, chunk:string, glsl:string):string {
	const token = `#include <${chunk}>`;
	const i = shader.indexOf(token);
	if (i < 0) {
		throw new Error(`Missing shader chunk: ${chunk}`);
	}
	const at = i + token.length;
	return `${shader.slice(0, at)}\n${glsl}${shader.slice(at)}`;
}

function insertInProgram(shader:{ vertexShader:string; fragmentShader:string }, chunk:string, glsl:string):void {
	const token = `#include <${chunk}>`;
	const inFrag = shader.fragmentShader.includes(token);
	const inVert = shader.vertexShader.includes(token);
	if (!inFrag && !inVert) {
		throw new Error(`Missing shader chunk: ${chunk}`);
	}
	if (inFrag) {
		shader.fragmentShader = insertAfterChunk(shader.fragmentShader, chunk, glsl);
	}
	if (inVert) {
		shader.vertexShader = insertAfterChunk(shader.vertexShader, chunk, glsl);
	}
}

/** Patch a built-in Three material. Inserts run only after documented `#include <chunk>` tokens. */
export function applyShaderFeatures(
	material:THREE.Material,
	inserts:ShaderInsert[],
	uniforms?:ShaderUniforms,
):void {
	const key = inserts.map((s) => s.id).join('|');
	material.customProgramCacheKey = () => key;
	material.onBeforeCompile = (shader) => {
		for (const ins of inserts) {
			insertInProgram(shader, ins.chunk, ins.glsl);
		}
		if (uniforms) {
			Object.assign(shader.uniforms, uniforms);
		}
	};
}
