<script lang="ts">
import Vue from 'vue'
import { heroicons } from '@/lib/icons/heroicons'

export default Vue.extend({
  name: 'HeroIcon',
  functional: true,
  props: {
    name: { type: String, required: true },
  },
  render(h, { props, data }) {
    const paths = (heroicons[props.name] ?? []).map((d) => h('path', {
      attrs: { d, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    }))
    const svg = h('svg', {
      attrs: {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'aria-hidden': 'true',
      },
    }, paths)
    return h('i', {
      ...data,
      staticClass: ['hi-icon', data.staticClass].filter(Boolean).join(' '),
    }, [svg])
  },
})
</script>
