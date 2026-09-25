/*
 * 地图定位用的城市坐标表。节点名的约定是「城市-商家」，城市名比主控从 IP 库查出来的
 * 经纬度可靠（IP 库过期会把冰岛画到马来西亚），所以地图先按城市名落点。
 * 只收 VPS 常见机房城市和国内主要城市；不在表里的名字会退到经纬度（见 geoPlace）。
 * tz 是标准时区偏移（小时，不含夏令时），只用来算"横跨几个时区"这种展示数字。
 */

export interface City {
  name: string
  lng: number
  lat: number
  region: string
  tz: number
  aliases?: string[]
}

export const CITIES: City[] = [
  // 北美
  { name: '洛杉矶', lng: -118.24, lat: 34.05, region: 'US', tz: -8, aliases: ['洛杉磯', 'los angeles', 'la'] },
  { name: '圣何塞', lng: -121.89, lat: 37.34, region: 'US', tz: -8, aliases: ['圣荷西', '聖荷西', 'san jose', '硅谷', '矽谷'] },
  { name: '旧金山', lng: -122.42, lat: 37.77, region: 'US', tz: -8, aliases: ['三藩市', '舊金山', 'san francisco', 'sf'] },
  { name: '圣迭戈', lng: -117.16, lat: 32.72, region: 'US', tz: -8, aliases: ['圣地牙哥', 'san diego'] },
  { name: '西雅图', lng: -122.33, lat: 47.61, region: 'US', tz: -8, aliases: ['西雅圖', 'seattle'] },
  { name: '波特兰', lng: -122.68, lat: 45.52, region: 'US', tz: -8, aliases: ['portland'] },
  { name: '拉斯维加斯', lng: -115.14, lat: 36.17, region: 'US', tz: -8, aliases: ['拉斯維加斯', 'las vegas'] },
  { name: '凤凰城', lng: -112.07, lat: 33.45, region: 'US', tz: -7, aliases: ['鳳凰城', 'phoenix'] },
  { name: '盐湖城', lng: -111.89, lat: 40.76, region: 'US', tz: -7, aliases: ['鹽湖城', 'salt lake city'] },
  { name: '丹佛', lng: -104.99, lat: 39.74, region: 'US', tz: -7, aliases: ['denver'] },
  { name: '达拉斯', lng: -96.8, lat: 32.78, region: 'US', tz: -6, aliases: ['達拉斯', 'dallas'] },
  { name: '休斯顿', lng: -95.37, lat: 29.76, region: 'US', tz: -6, aliases: ['休斯敦', '休士頓', 'houston'] },
  { name: '芝加哥', lng: -87.63, lat: 41.88, region: 'US', tz: -6, aliases: ['chicago'] },
  { name: '堪萨斯城', lng: -94.58, lat: 39.1, region: 'US', tz: -6, aliases: ['kansas city'] },
  { name: '亚特兰大', lng: -84.39, lat: 33.75, region: 'US', tz: -5, aliases: ['亞特蘭大', 'atlanta'] },
  { name: '迈阿密', lng: -80.19, lat: 25.76, region: 'US', tz: -5, aliases: ['邁阿密', 'miami'] },
  { name: '纽约', lng: -74.01, lat: 40.71, region: 'US', tz: -5, aliases: ['紐約', 'new york', 'nyc'] },
  { name: '华盛顿', lng: -77.04, lat: 38.91, region: 'US', tz: -5, aliases: ['華盛頓', 'washington'] },
  { name: '阿什本', lng: -77.49, lat: 39.04, region: 'US', tz: -5, aliases: ['弗吉尼亚', '維吉尼亞', 'ashburn', 'virginia'] },
  { name: '费城', lng: -75.17, lat: 39.95, region: 'US', tz: -5, aliases: ['費城', 'philadelphia'] },
  { name: '波士顿', lng: -71.06, lat: 42.36, region: 'US', tz: -5, aliases: ['波士頓', 'boston'] },
  { name: '底特律', lng: -83.05, lat: 42.33, region: 'US', tz: -5, aliases: ['detroit'] },
  { name: '夏威夷', lng: -157.86, lat: 21.31, region: 'US', tz: -10, aliases: ['檀香山', 'hawaii', 'honolulu'] },
  { name: '多伦多', lng: -79.38, lat: 43.65, region: 'CA', tz: -5, aliases: ['多倫多', 'toronto'] },
  { name: '蒙特利尔', lng: -73.57, lat: 45.5, region: 'CA', tz: -5, aliases: ['蒙特婁', 'montreal'] },
  { name: '温哥华', lng: -123.12, lat: 49.28, region: 'CA', tz: -8, aliases: ['溫哥華', 'vancouver'] },
  { name: '墨西哥城', lng: -99.13, lat: 19.43, region: 'MX', tz: -6, aliases: ['mexico city'] },
  // 南美
  { name: '圣保罗', lng: -46.63, lat: -23.55, region: 'BR', tz: -3, aliases: ['聖保羅', 'sao paulo'] },
  { name: '布宜诺斯艾利斯', lng: -58.38, lat: -34.6, region: 'AR', tz: -3, aliases: ['buenos aires'] },
  { name: '圣地亚哥', lng: -70.67, lat: -33.45, region: 'CL', tz: -4, aliases: ['聖地牙哥', 'santiago'] },
  { name: '波哥大', lng: -74.07, lat: 4.71, region: 'CO', tz: -5, aliases: ['bogota'] },
  // 欧洲
  { name: '伦敦', lng: -0.13, lat: 51.51, region: 'GB', tz: 0, aliases: ['倫敦', 'london'] },
  { name: '曼彻斯特', lng: -2.24, lat: 53.48, region: 'GB', tz: 0, aliases: ['曼徹斯特', 'manchester'] },
  { name: '都柏林', lng: -6.26, lat: 53.35, region: 'IE', tz: 0, aliases: ['dublin'] },
  { name: '雷克雅未克', lng: -21.94, lat: 64.15, region: 'IS', tz: 0, aliases: ['雷克雅維克', '雷克雅维克', 'reykjavik'] },
  { name: '里斯本', lng: -9.14, lat: 38.72, region: 'PT', tz: 0, aliases: ['lisbon'] },
  { name: '马德里', lng: -3.7, lat: 40.42, region: 'ES', tz: 1, aliases: ['馬德里', 'madrid'] },
  { name: '巴塞罗那', lng: 2.17, lat: 41.39, region: 'ES', tz: 1, aliases: ['巴塞隆納', 'barcelona'] },
  { name: '巴黎', lng: 2.35, lat: 48.86, region: 'FR', tz: 1, aliases: ['paris'] },
  { name: '马赛', lng: 5.37, lat: 43.3, region: 'FR', tz: 1, aliases: ['馬賽', 'marseille'] },
  { name: '布鲁塞尔', lng: 4.35, lat: 50.85, region: 'BE', tz: 1, aliases: ['布魯塞爾', 'brussels'] },
  { name: '阿姆斯特丹', lng: 4.9, lat: 52.37, region: 'NL', tz: 1, aliases: ['amsterdam'] },
  { name: '鹿特丹', lng: 4.48, lat: 51.92, region: 'NL', tz: 1, aliases: ['rotterdam'] },
  { name: '卢森堡', lng: 6.13, lat: 49.61, region: 'LU', tz: 1, aliases: ['盧森堡', 'luxembourg'] },
  { name: '法兰克福', lng: 8.68, lat: 50.11, region: 'DE', tz: 1, aliases: ['法蘭克福', 'frankfurt'] },
  { name: '杜塞尔多夫', lng: 6.78, lat: 51.23, region: 'DE', tz: 1, aliases: ['杜塞道夫', 'dusseldorf'] },
  { name: '柏林', lng: 13.41, lat: 52.52, region: 'DE', tz: 1, aliases: ['berlin'] },
  { name: '慕尼黑', lng: 11.58, lat: 48.14, region: 'DE', tz: 1, aliases: ['munich'] },
  { name: '纽伦堡', lng: 11.08, lat: 49.45, region: 'DE', tz: 1, aliases: ['紐倫堡', 'nuremberg'] },
  { name: '法尔肯施泰因', lng: 12.37, lat: 50.48, region: 'DE', tz: 1, aliases: ['falkenstein'] },
  { name: '苏黎世', lng: 8.54, lat: 47.38, region: 'CH', tz: 1, aliases: ['蘇黎世', 'zurich'] },
  { name: '维也纳', lng: 16.37, lat: 48.21, region: 'AT', tz: 1, aliases: ['維也納', 'vienna'] },
  { name: '米兰', lng: 9.19, lat: 45.46, region: 'IT', tz: 1, aliases: ['米蘭', 'milan'] },
  { name: '罗马', lng: 12.5, lat: 41.9, region: 'IT', tz: 1, aliases: ['羅馬', 'rome'] },
  { name: '斯德哥尔摩', lng: 18.07, lat: 59.33, region: 'SE', tz: 1, aliases: ['斯德哥爾摩', 'stockholm'] },
  { name: '奥斯陆', lng: 10.75, lat: 59.91, region: 'NO', tz: 1, aliases: ['奧斯陸', 'oslo'] },
  { name: '哥本哈根', lng: 12.57, lat: 55.68, region: 'DK', tz: 1, aliases: ['copenhagen'] },
  { name: '赫尔辛基', lng: 24.94, lat: 60.17, region: 'FI', tz: 2, aliases: ['赫爾辛基', 'helsinki'] },
  { name: '华沙', lng: 21.01, lat: 52.23, region: 'PL', tz: 1, aliases: ['華沙', 'warsaw'] },
  { name: '布拉格', lng: 14.44, lat: 50.08, region: 'CZ', tz: 1, aliases: ['prague'] },
  { name: '布达佩斯', lng: 19.04, lat: 47.5, region: 'HU', tz: 1, aliases: ['布達佩斯', 'budapest'] },
  { name: '布加勒斯特', lng: 26.1, lat: 44.43, region: 'RO', tz: 2, aliases: ['bucharest'] },
  { name: '索非亚', lng: 23.32, lat: 42.7, region: 'BG', tz: 2, aliases: ['索菲亚', 'sofia'] },
  { name: '雅典', lng: 23.73, lat: 37.98, region: 'GR', tz: 2, aliases: ['athens'] },
  { name: '基辅', lng: 30.52, lat: 50.45, region: 'UA', tz: 2, aliases: ['基輔', 'kyiv', 'kiev'] },
  { name: '莫斯科', lng: 37.62, lat: 55.76, region: 'RU', tz: 3, aliases: ['moscow'] },
  { name: '圣彼得堡', lng: 30.32, lat: 59.93, region: 'RU', tz: 3, aliases: ['聖彼得堡', 'saint petersburg'] },
  { name: '伊斯坦布尔', lng: 28.98, lat: 41.01, region: 'TR', tz: 3, aliases: ['伊斯坦堡', 'istanbul'] },
  // 中东 / 非洲
  { name: '迪拜', lng: 55.27, lat: 25.2, region: 'AE', tz: 4, aliases: ['杜拜', 'dubai'] },
  { name: '特拉维夫', lng: 34.78, lat: 32.09, region: 'IL', tz: 2, aliases: ['tel aviv'] },
  { name: '约翰内斯堡', lng: 28.05, lat: -26.2, region: 'ZA', tz: 2, aliases: ['約翰尼斯堡', 'johannesburg'] },
  { name: '开普敦', lng: 18.42, lat: -33.92, region: 'ZA', tz: 2, aliases: ['開普敦', 'cape town'] },
  { name: '开罗', lng: 31.24, lat: 30.04, region: 'EG', tz: 2, aliases: ['開羅', 'cairo'] },
  { name: '拉各斯', lng: 3.38, lat: 6.52, region: 'NG', tz: 1, aliases: ['lagos'] },
  { name: '内罗毕', lng: 36.82, lat: -1.29, region: 'KE', tz: 3, aliases: ['奈洛比', 'nairobi'] },
  // 南亚 / 东南亚
  { name: '孟买', lng: 72.88, lat: 19.08, region: 'IN', tz: 5.5, aliases: ['孟買', 'mumbai'] },
  { name: '班加罗尔', lng: 77.59, lat: 12.97, region: 'IN', tz: 5.5, aliases: ['班加羅爾', 'bangalore', 'bengaluru'] },
  { name: '新德里', lng: 77.21, lat: 28.61, region: 'IN', tz: 5.5, aliases: ['德里', 'new delhi', 'delhi'] },
  { name: '新加坡', lng: 103.82, lat: 1.35, region: 'SG', tz: 8, aliases: ['狮城', '獅城', 'singapore', 'sg'] },
  { name: '吉隆坡', lng: 101.69, lat: 3.14, region: 'MY', tz: 8, aliases: ['kuala lumpur', 'kl'] },
  { name: '曼谷', lng: 100.5, lat: 13.76, region: 'TH', tz: 7, aliases: ['bangkok'] },
  { name: '胡志明', lng: 106.63, lat: 10.82, region: 'VN', tz: 7, aliases: ['胡志明市', '西贡', '西貢', 'ho chi minh', 'saigon'] },
  { name: '河内', lng: 105.85, lat: 21.03, region: 'VN', tz: 7, aliases: ['河內', 'hanoi'] },
  { name: '雅加达', lng: 106.85, lat: -6.21, region: 'ID', tz: 7, aliases: ['雅加達', 'jakarta'] },
  { name: '马尼拉', lng: 120.98, lat: 14.6, region: 'PH', tz: 8, aliases: ['馬尼拉', 'manila'] },
  // 港澳台
  { name: '香港', lng: 114.17, lat: 22.32, region: 'HK', tz: 8, aliases: ['hong kong', 'hongkong', 'hk'] },
  { name: '澳门', lng: 113.55, lat: 22.2, region: 'MO', tz: 8, aliases: ['澳門', 'macau', 'macao'] },
  { name: '台北', lng: 121.57, lat: 25.03, region: 'TW', tz: 8, aliases: ['臺北', 'taipei'] },
  { name: '新竹', lng: 120.97, lat: 24.8, region: 'TW', tz: 8, aliases: ['hsinchu'] },
  { name: '台中', lng: 120.67, lat: 24.15, region: 'TW', tz: 8, aliases: ['臺中', 'taichung'] },
  { name: '彰化', lng: 120.54, lat: 24.08, region: 'TW', tz: 8, aliases: ['changhua'] },
  { name: '高雄', lng: 120.3, lat: 22.63, region: 'TW', tz: 8, aliases: ['kaohsiung'] },
  // 日韩
  { name: '东京', lng: 139.69, lat: 35.69, region: 'JP', tz: 9, aliases: ['東京', 'tokyo'] },
  { name: '大阪', lng: 135.5, lat: 34.69, region: 'JP', tz: 9, aliases: ['osaka'] },
  { name: '名古屋', lng: 136.91, lat: 35.18, region: 'JP', tz: 9, aliases: ['nagoya'] },
  { name: '福冈', lng: 130.4, lat: 33.59, region: 'JP', tz: 9, aliases: ['福岡', 'fukuoka'] },
  { name: '札幌', lng: 141.35, lat: 43.06, region: 'JP', tz: 9, aliases: ['sapporo'] },
  { name: '首尔', lng: 126.98, lat: 37.57, region: 'KR', tz: 9, aliases: ['首爾', '汉城', 'seoul'] },
  { name: '釜山', lng: 129.08, lat: 35.18, region: 'KR', tz: 9, aliases: ['busan'] },
  // 大洋洲
  { name: '悉尼', lng: 151.21, lat: -33.87, region: 'AU', tz: 10, aliases: ['雪梨', 'sydney'] },
  { name: '墨尔本', lng: 144.96, lat: -37.81, region: 'AU', tz: 10, aliases: ['墨爾本', 'melbourne'] },
  { name: '布里斯班', lng: 153.03, lat: -27.47, region: 'AU', tz: 10, aliases: ['brisbane'] },
  { name: '珀斯', lng: 115.86, lat: -31.95, region: 'AU', tz: 8, aliases: ['伯斯', 'perth'] },
  { name: '奥克兰', lng: 174.76, lat: -36.85, region: 'NZ', tz: 12, aliases: ['奧克蘭', 'auckland'] },
  // 中国大陆
  { name: '北京', lng: 116.4, lat: 39.9, region: 'CN', tz: 8, aliases: ['beijing'] },
  { name: '上海', lng: 121.47, lat: 31.23, region: 'CN', tz: 8, aliases: ['shanghai'] },
  { name: '广州', lng: 113.26, lat: 23.13, region: 'CN', tz: 8, aliases: ['廣州', 'guangzhou'] },
  { name: '深圳', lng: 114.06, lat: 22.54, region: 'CN', tz: 8, aliases: ['shenzhen'] },
  { name: '杭州', lng: 120.15, lat: 30.27, region: 'CN', tz: 8, aliases: ['hangzhou'] },
  { name: '南京', lng: 118.8, lat: 32.06, region: 'CN', tz: 8, aliases: ['nanjing'] },
  { name: '苏州', lng: 120.58, lat: 31.3, region: 'CN', tz: 8, aliases: ['蘇州', 'suzhou'] },
  { name: '宁波', lng: 121.55, lat: 29.87, region: 'CN', tz: 8, aliases: ['寧波', 'ningbo'] },
  { name: '成都', lng: 104.07, lat: 30.57, region: 'CN', tz: 8, aliases: ['chengdu'] },
  { name: '重庆', lng: 106.55, lat: 29.56, region: 'CN', tz: 8, aliases: ['重慶', 'chongqing'] },
  { name: '武汉', lng: 114.31, lat: 30.59, region: 'CN', tz: 8, aliases: ['武漢', 'wuhan'] },
  { name: '西安', lng: 108.94, lat: 34.34, region: 'CN', tz: 8, aliases: ["xi'an", 'xian'] },
  { name: '郑州', lng: 113.63, lat: 34.75, region: 'CN', tz: 8, aliases: ['鄭州', 'zhengzhou'] },
  { name: '长沙', lng: 112.94, lat: 28.23, region: 'CN', tz: 8, aliases: ['長沙', 'changsha'] },
  { name: '福州', lng: 119.3, lat: 26.07, region: 'CN', tz: 8, aliases: ['fuzhou'] },
  { name: '厦门', lng: 118.09, lat: 24.48, region: 'CN', tz: 8, aliases: ['廈門', 'xiamen'] },
  { name: '泉州', lng: 118.68, lat: 24.87, region: 'CN', tz: 8, aliases: ['quanzhou'] },
  { name: '青岛', lng: 120.38, lat: 36.07, region: 'CN', tz: 8, aliases: ['青島', 'qingdao'] },
  { name: '济南', lng: 117.12, lat: 36.65, region: 'CN', tz: 8, aliases: ['濟南', 'jinan'] },
  { name: '天津', lng: 117.2, lat: 39.08, region: 'CN', tz: 8, aliases: ['tianjin'] },
  { name: '石家庄', lng: 114.51, lat: 38.04, region: 'CN', tz: 8, aliases: ['石家莊', 'shijiazhuang'] },
  { name: '太原', lng: 112.55, lat: 37.87, region: 'CN', tz: 8, aliases: ['taiyuan'] },
  { name: '沈阳', lng: 123.43, lat: 41.8, region: 'CN', tz: 8, aliases: ['瀋陽', 'shenyang'] },
  { name: '大连', lng: 121.6, lat: 38.91, region: 'CN', tz: 8, aliases: ['大連', 'dalian'] },
  { name: '哈尔滨', lng: 126.53, lat: 45.8, region: 'CN', tz: 8, aliases: ['哈爾濱', 'harbin'] },
  { name: '合肥', lng: 117.23, lat: 31.82, region: 'CN', tz: 8, aliases: ['hefei'] },
  { name: '南昌', lng: 115.86, lat: 28.68, region: 'CN', tz: 8, aliases: ['nanchang'] },
  { name: '昆明', lng: 102.71, lat: 25.04, region: 'CN', tz: 8, aliases: ['kunming'] },
  { name: '贵阳', lng: 106.63, lat: 26.65, region: 'CN', tz: 8, aliases: ['貴陽', 'guiyang'] },
  { name: '南宁', lng: 108.32, lat: 22.82, region: 'CN', tz: 8, aliases: ['南寧', 'nanning'] },
  { name: '海口', lng: 110.32, lat: 20.04, region: 'CN', tz: 8, aliases: ['haikou'] },
  { name: '兰州', lng: 103.83, lat: 36.06, region: 'CN', tz: 8, aliases: ['蘭州', 'lanzhou'] },
  { name: '乌鲁木齐', lng: 87.62, lat: 43.83, region: 'CN', tz: 8, aliases: ['烏魯木齊', 'urumqi'] },
  { name: '呼和浩特', lng: 111.75, lat: 40.84, region: 'CN', tz: 8, aliases: ['hohhot'] },
  { name: '佛山', lng: 113.12, lat: 23.02, region: 'CN', tz: 8, aliases: ['foshan'] },
  { name: '东莞', lng: 113.75, lat: 23.02, region: 'CN', tz: 8, aliases: ['東莞', 'dongguan'] },
  { name: '珠海', lng: 113.58, lat: 22.27, region: 'CN', tz: 8, aliases: ['zhuhai'] },
  { name: '温州', lng: 120.7, lat: 28.0, region: 'CN', tz: 8, aliases: ['溫州', 'wenzhou'] },
  { name: '无锡', lng: 120.31, lat: 31.49, region: 'CN', tz: 8, aliases: ['無錫', 'wuxi'] },
  { name: '徐州', lng: 117.19, lat: 34.26, region: 'CN', tz: 8, aliases: ['xuzhou'] },
]

/** 常见机房地区的中文名；不在表里的地区回退到地图数据里的英文名或代码 */
export const REGION_CN: Record<string, string> = {
  US: '美国', JP: '日本', HK: '香港', DE: '德国', AU: '澳大利亚', CN: '中国',
  NL: '荷兰', SG: '新加坡', TW: '台湾', KR: '韩国', GB: '英国', FR: '法国',
  CA: '加拿大', RU: '俄罗斯', IN: '印度', BR: '巴西', VN: '越南', TH: '泰国',
  MY: '马来西亚', ID: '印尼', PH: '菲律宾', TR: '土耳其', IT: '意大利', ES: '西班牙',
  PL: '波兰', SE: '瑞典', FI: '芬兰', NO: '挪威', CH: '瑞士', AT: '奥地利',
  UA: '乌克兰', AE: '阿联酋', ZA: '南非', MX: '墨西哥', AR: '阿根廷', CL: '智利',
  IS: '冰岛', MO: '澳门', IE: '爱尔兰', PT: '葡萄牙', BE: '比利时', LU: '卢森堡',
  DK: '丹麦', CZ: '捷克', HU: '匈牙利', RO: '罗马尼亚', BG: '保加利亚', GR: '希腊',
  IL: '以色列', EG: '埃及', NG: '尼日利亚', KE: '肯尼亚', NZ: '新西兰', CO: '哥伦比亚',
}

export const CONTINENTS = ['亚洲', '欧洲', '北美洲', '南美洲', '非洲', '大洋洲'] as const
export type Continent = (typeof CONTINENTS)[number]

const CONTINENT_MEMBERS: Record<Continent, string[]> = {
  亚洲: ['CN', 'HK', 'MO', 'TW', 'JP', 'KR', 'SG', 'MY', 'TH', 'VN', 'ID', 'PH', 'IN', 'PK', 'BD', 'LK', 'KH', 'MM', 'MN', 'KZ', 'UZ', 'AE', 'SA', 'QA', 'IL', 'TR', 'IR', 'IQ', 'JO', 'KW', 'OM', 'BH', 'GE', 'AM', 'AZ', 'NP'],
  欧洲: ['GB', 'IE', 'IS', 'DE', 'NL', 'BE', 'LU', 'FR', 'ES', 'PT', 'IT', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'UA', 'RU', 'BY', 'MD', 'RS', 'HR', 'SI', 'BA', 'ME', 'MK', 'AL', 'LT', 'LV', 'EE', 'CY', 'MT'],
  北美洲: ['US', 'CA', 'MX', 'GT', 'CR', 'PA', 'CU', 'DO', 'PR', 'JM', 'BZ', 'HN', 'SV', 'NI'],
  南美洲: ['BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'UY', 'PY', 'BO'],
  非洲: ['ZA', 'EG', 'NG', 'KE', 'MA', 'TN', 'DZ', 'GH', 'ET', 'TZ', 'UG', 'SN', 'CI', 'MU', 'MG'],
  大洋洲: ['AU', 'NZ', 'FJ', 'PG'],
}

const CONTINENT_OF = new Map<string, Continent>()
for (const c of CONTINENTS) for (const code of CONTINENT_MEMBERS[c]) CONTINENT_OF.set(code, c)

export function continentOf(region: string | null | undefined): Continent | null {
  return region ? CONTINENT_OF.get(region.toUpperCase()) ?? null : null
}

function normalize(key: string) {
  return key.trim().toLowerCase().replace(/\s+/g, ' ')
}

const INDEX = new Map<string, City>()
for (const c of CITIES) {
  INDEX.set(normalize(c.name), c)
  for (const a of c.aliases ?? []) INDEX.set(normalize(a), c)
}

/** 按名字/别名查城市；大小写、首尾空格不敏感 */
export function findCity(key: string): City | null {
  return INDEX.get(normalize(key)) ?? null
}
