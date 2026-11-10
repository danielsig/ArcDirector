<script setup lang="ts">
/**
 * An on/off switch: a pill whose knob slides across when on. It reads "On" or "Off" to a screen reader.
 * `decorative` draws the same pill with no control of its own, for a card that is itself the button.
 */
const props = defineProps<{ on:boolean; disabled?:boolean; decorative?:boolean }>();
const emit = defineEmits<{ toggle:[] }>();

function press(event:MouseEvent):void {
	if (props.decorative) {
		return;
	}
	event.stopPropagation();
	emit('toggle');
}
</script>

<template>
	<component
		:is="decorative ? 'span' : 'button'"
		class="switch"
		:class="{ on }"
		:type="decorative ? undefined : 'button'"
		:aria-pressed="decorative ? undefined : on"
		:aria-hidden="decorative || undefined"
		:disabled="decorative ? undefined : disabled"
		@click="press"
	>
		{{ on ? 'On' : 'Off' }}
	</component>
</template>

<style scoped>
.switch {
	position: relative;
	flex: 0 0 64px;
	width: 64px;
	height: 34px;
	padding: 0;
	font-size: 0;
	background: var(--parchment-deep);
	border: var(--line-thin) solid var(--ink);
	border-radius: 17px;
	cursor: pointer;
	transition: background var(--quick) var(--ease-out);
}

.switch::after {
	content: "";
	position: absolute;
	top: 3px;
	left: 3px;
	width: 24px;
	height: 24px;
	box-sizing: border-box;
	border-radius: 50%;
	background: var(--parchment);
	border: var(--line-thin) solid var(--ink);
	transition: transform var(--slow) var(--ease-pop);
}

.switch.on {
	background: var(--ink);
}

.switch.on::after {
	transform: translateX(30px);
	background: var(--parchment);
	border-color: var(--parchment);
}

.switch:disabled {
	opacity: 0.5;
	cursor: default;
}
</style>
