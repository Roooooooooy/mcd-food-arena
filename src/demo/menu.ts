import type { CatalogSnapshot } from '../shared/contracts.ts';

type DemoEntry = readonly [
  slug: string,
  name: string,
  referencePriceCents: number | null,
  kcal: number | null,
  proteinG: number | null,
  attributes: readonly string[],
];

interface DemoStage {
  id: string;
  name: string;
  entries: readonly DemoEntry[];
}

// Original synthetic restaurant foods. Prices and nutrition are invented sample
// reference data, not official menu facts or a verified order quote.
const stages: readonly DemoStage[] = [
  {
    id: 'burger',
    name: '汉堡',
    entries: [
      ['cheese-beef', '芝士厚牛堡', 2600, 510, 25, ['牛肉', '芝士']],
      ['pepper-chicken', '黑椒脆鸡堡', 2200, 470, 23, ['鸡肉', '微辣']],
      ['double-beef', '双层洋葱牛堡', 3200, 650, 34, ['牛肉', '双层']],
      ['mushroom-cheese', '烤菇芝士堡', 2400, 390, 14, ['蘑菇', '芝士']],
      ['grilled-chicken', '香草烤鸡堡', 2500, 420, 28, ['鸡肉', '烤制']],
    ],
  },
  {
    id: 'chicken',
    name: '鸡肉',
    entries: [
      ['crispy-wings', '香脆双翅', 1800, 290, 19, ['炸制', '微辣']],
      ['pepper-bites', '椒香鸡块', 1600, 260, 17, ['鸡块', '椒香']],
      ['roasted-leg', '迷迭香烤鸡腿', 2200, 320, 27, ['烤制', '香草']],
      ['lemon-strips', '柠香鸡柳', 1900, 280, 22, ['鸡柳', '柠檬']],
      ['honey-wings', '蜜汁烤翅', 2000, 310, 20, ['烤制', '甜口']],
    ],
  },
  {
    id: 'side',
    name: '小食',
    entries: [
      ['sea-salt-fries', '海盐细薯条', 1200, 310, 4, ['薯条', '海盐']],
      ['potato-wedges', '香草薯角', 1500, 330, 5, ['土豆', '香草']],
      ['onion-rings', '金黄洋葱圈', 1400, 290, 4, ['洋葱', '炸制']],
      ['sweet-corn', '奶香甜玉米', 1000, 160, 5, ['玉米', '甜口']],
      ['garden-salad', '田园蔬菜杯', 1300, 90, 3, ['蔬菜', '清爽']],
    ],
  },
  {
    id: 'drink',
    name: '冷饮',
    entries: [
      ['cola', '冰爽可乐', 900, 140, 0, ['含糖', '气泡']],
      ['zero-soda', '无糖气泡饮', 1000, 0, 0, ['无糖', '气泡']],
      ['lemon-tea', '柠檬冰茶', 1200, 110, 0, ['柠檬', '冰茶']],
      ['orange-drink', '鲜橙风味饮', 1300, 130, 1, ['橙味', '含糖']],
      // Deliberately unknown: exercise unknown-value rendering without guesses.
      ['lychee-tea', '荔枝清茶', null, null, null, ['荔枝', '冰茶']],
    ],
  },
  {
    id: 'coffee',
    name: '咖啡',
    entries: [
      ['americano', '经典美式', 1400, 8, 1, ['咖啡', '无奶']],
      ['latte', '醇香拿铁', 1900, 160, 8, ['咖啡', '牛奶']],
      ['oat-latte', '燕麦拿铁', 2200, 180, 4, ['咖啡', '燕麦']],
      ['cappuccino', '绵云卡布', 1900, 130, 7, ['咖啡', '奶泡']],
      ['caramel-coffee', '焦糖奶咖', 2300, 240, 7, ['咖啡', '甜口']],
    ],
  },
  {
    id: 'dessert',
    name: '甜品',
    entries: [
      ['vanilla-cup', '香草冰淇淋杯', 1000, 180, 4, ['冰淇淋', '香草']],
      ['cocoa-swirl', '可可旋风杯', 1500, 280, 5, ['冰淇淋', '可可']],
      ['berry-sundae', '莓果圣代', 1400, 230, 4, ['冰淇淋', '莓果']],
      ['mango-yogurt', '芒果酸奶杯', 1600, 190, 6, ['酸奶', '芒果']],
      ['cookie-cream', '曲奇奶油杯', 1700, 310, 5, ['曲奇', '奶油']],
    ],
  },
  {
    id: 'pie',
    name: '烘焙派',
    entries: [
      ['apple', '肉桂苹果派', 900, 230, 3, ['苹果', '肉桂']],
      ['taro', '绵香芋泥派', 1000, 250, 3, ['芋泥', '甜口']],
      ['pineapple', '金黄菠萝派', 900, 220, 2, ['菠萝', '酸甜']],
      ['red-bean', '红豆糯香派', 1100, 260, 5, ['红豆', '甜口']],
      ['cheese-corn', '芝士玉米派', 1200, 280, 7, ['芝士', '玉米']],
    ],
  },
  {
    id: 'breakfast',
    name: '早餐',
    entries: [
      ['egg-muffin', '芝士鸡蛋松饼', 1800, 310, 15, ['鸡蛋', '芝士']],
      ['bacon-roll', '培根早餐卷', 2100, 390, 18, ['培根', '鸡蛋']],
      ['chicken-muffin', '烤鸡早餐松饼', 2000, 350, 24, ['鸡肉', '烤制']],
      ['pancakes', '枫糖热松饼', 1600, 360, 7, ['松饼', '甜口']],
      ['oatmeal', '暖心燕麦粥', 1400, 210, 6, ['燕麦', '热食']],
    ],
  },
];

export function demoCatalog(): CatalogSnapshot {
  return {
    contextKey: 'demo:mcd-food-arena:v1',
    mode: 'demo',
    store: null,
    loadedAt: '2026-10-14T00:00:00.000Z',
    complete: true,
    items: stages.flatMap(stage => stage.entries.map(([slug, name, referencePriceCents, kcal, proteinG, attributes]) => ({
      id: `demo:${stage.id}:${slug}`,
      officialCode: null,
      name,
      stageId: stage.id,
      sourceCategory: stage.name,
      imageUrl: null,
      referencePriceCents,
      attributes: [...attributes],
      nutrition: {
        ...(kcal === null ? {} : { kcal }),
        ...(proteinG === null ? {} : { proteinG }),
      },
      mode: 'demo',
    }))),
  };
}
