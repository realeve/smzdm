let axios = require('axios');
let parser = require('../util/htmlParser');

let spiderSetting = require('../util/spiderSetting');
let db = require('../db/wfx');

let util = require('../util/common');

// // 载入模块
// var Segment = require('segment');
// // 创建实例
// var segment = new Segment();
// // 使用默认的识别模块及字典，载入字典文件需要1秒，仅初始化时执行一次即可
// segment.useDefault();
// segment.loadSynonymDict('synonym.txt');

// 获取商品主表信息
async function getGoodsById(url, page = 2) {
    console.log('正在抓取第' + page + '页');
    let config = {
        method: 'get',
        url,
        params: {
            p: page
        },
        headers: spiderSetting.headers.wfx
    }
    return await axios(config).then(res => {
        let goodItem = res.data;
        // 如果当前页无数据或小于每页最大产品数量10，则表示下一页无数据
        if (goodItem.length == 0 || goodItem.length < 10) {
            return goodItem;
        }
        return getGoodsById(url, page + 1).then(res => [...goodItem, ...res]);
    }).catch(e => console.log(e));
}

function formatterData(obj, keys) {
    // 删除无用数据
    keys.forEach(key => Reflect.deleteProperty(obj, key));

    obj.rec_date = util.getNow();
    // 数据清洗
    if (obj.sales_volume == null) {
        obj.sales_volume = 0;
    }
    if (obj.category_id == null) {
        obj.category_id = 0;
    }
    return obj;
}

/**
 * 获取商品列表(价格、销量、库存、商品名、图片、链接)， 具体思路：
 * 
 * 1.所有接口均不能获取第1页最详细数据，在其它页数据中存储了产品销量，库存信息
 * 2.按价格从高至低获取第2-n页产品数据 A
 * 3.按价格从低至高获取第n-1,n页产品数据 B
 * 4.获取第3步B中最后10第数据，并同第2步A的数据合并
 * 
 */
async function getGoodsList() {
    let urlUp = 'http://www.symint615.com/Item/lists/order/up';
    let urlDown = 'http://www.symint615.com/Item/lists/order/down';

    let goodList = [];
    goodList = await getGoodsById(urlUp);

    let page = parseInt(goodList.length / 10) + 1;
    let res = await getGoodsById(urlDown, page);

    let appendList = res.slice(res.length - 10, res.length);
    goodList = [...goodList, ...appendList];
    goodList.sort((a, b) => {
        return a.item_id - b.item_id;
    })

    let keys = ['hide_stock', 'buy_method', 'buy_url', 'is_show_sale', 'buy_need_points', 'is_compress', 'group', 'sale_num', 'basic_sales', 'join_level_discount', 'type'];
    goodList = goodList.map(item => formatterData(item, keys));

    return goodList;
}

async function getDetailById(id) {
    let url = 'http://www.symint615.com/Item/detail_ajax';
    let config = {
        method: 'get',
        url,
        params: {
            id,
            pid: 0,
            bid: 0
        },
        headers: spiderSetting.headers.wfx
    };

    return await axios(config).then(result => {
        let obj = result.data;
        // 系统维护升级时，输出为网页数据
        if (typeof obj != 'object') {
            console.log('wfx系统维护中,数据采集失败...');
            return {
                item_id: id
            };
        }
        let html = obj.data;
        let info = parser.wfx.shareInfo(html);
        info.item_id = id;
        return info;
    }).catch(e => {
        console.log(e);
    })
}

async function getDetail() {
    let data = await db.getGoodList();
    let results = [];
    for (let i = 0; i < data.length; i++) {
        console.log(`正在抓取第${i}/${data.length}页`);
        let record = await getDetailById(data[i].item_id);
        results.push(record);
    }
    return results;
}

async function getCommentByPage(item_id, page = 1) {
    console.log('正在抓取第' + page + '页');
    let url = 'http://www.symint615.com/Item/getItemComment';
    let config = {
        method: 'get',
        url,
        params: {
            item_id,
            p: page
        },
        headers: spiderSetting.headers.wfx
    };

    let res = await axios(config);
    let comments = res.data;
    // 2017年接口升级后，第2页以后的评论返回结果非标准json格式，即内容没在 res.data中，而是直接返回 array结果。
    let data = comments.data;
    // 如果当前页无数据或小于每页最大产品数量10，则表示下一页无数据
    if (typeof data.length == 0) {
        return [];
    }
    return parser.wfx.commentInfo(data, item_id);
}

async function getCommentById(item_id, lastId = 0) {

    let isEnd = false;
    let records = [];
    for (let i = 1; !isEnd; i++) {
        // 获取单页数据
        let data = await getCommentByPage(item_id, i);
        //数据过滤（默认id从大到小排列，前序获取数据后表示后序数据已经入库）
        data = data.filter(item => item.order_item_id > lastId);
        if (data.length < 10) {
            isEnd = true;
        }
        records = [...records, ...data];
    }
    return records;
}

async function getComment() {
    let data = await db.getGoodList();
    let maxId = data.length;
    let results = [];
    for (let i = 1; i < maxId; i++) {
        console.log(`正在抓取第${i}/${data.length}页`);
        let record = await getCommentById(data[i].item_id);
        results.push(record);
    }
    // 去除空数据
    let arr = [];
    result.forEach(item => {
        if (item == null) {
            return;
        }
        if (JSON.stringify(item) != '[]') {
            arr.push(item);
        }
    })
    return arr;
}

async function handleComment() {
    // 商品id列表
    let data = await db.getGoodList();
    let maxId = data.length;

    // 最近一次更新位置
    let lastData = await db.getLastComment();

    let results = [],
        lastId;
    let start = 1;
    // maxId = 8;
    for (let i = start; i < maxId; i++) {
        let curId = data[i].item_id;
        console.log(`正在抓取第${i}/${data.length}页`);

        //获取当前产品最近一次评论信息
        lastId = lastData.filter(item => item.item_id == curId);
        lastId = lastId.length ? lastId[0].order_item_id : 0;
        // 测试代码
        // lastId = 2982707;
        let record = await getCommentById(curId, lastId);
        results.push(record);
    }

    // 去除空数据
    let arr = [];
    results.forEach(item => {
        if (item == null) {
            return;
        }
        if (JSON.stringify(item) != '[]') {
            arr.push(item);
        }
    })
    return arr;
}

// 用node-segment分词并做词性处理
// function splitCommentBySegment(req, res) {
//     let data = require('../data/wfx_comment.json');
//     let result = [];

//     data.forEach(comment => {
//         comment.forEach(item => {
//             let segText = segment.doSegment(item.detail, {
//                 stripPunctuation: true
//             });
//             result.push(Object.assign(util.handleWordSegment(segText), {
//                 item_id: item.item_id,
//                 detail: item.detail
//             }));
//         });
//     });

//     res.json(result);
// }

async function splitComment(data) {
    if (typeof data == 'undefined') {
        data = require('../data/wfx_comment.json');
    }
    let result = [];

    data.forEach(comment => {
        comment.forEach(item => {
            result.push(item);
        });
    });

    let comments = [];

    // 按序号依次读取数据，降低接口请求频次，必要时应增加延时
    // 用for循环同步执行，即在await完成之后才执行 i++
    // 用forEach/map等遍历函数，其回调函数不能是 async函数，无法在其中使用await,数据将被异步执行
    for (let i = 0; i < result.length; i++) {
        let item = result[i];
        await util.wordSegment(item.detail).then(response => {
            comments.push({
                detail: item.detail,
                item_id: item.item_id,
                tokens: response.tokens,
                combtokens: response.combtokens,
                comment_id: item.order_item_id
            });
        })
        console.log('第' + i + '条数据读取完毕\n');
    }
    return comments;
}

async function getCommentScore(data) {
    if (typeof data == 'undefined') {
        data = require('../data/wfx_comment.json');
    }
    let result = [];

    data.forEach(comment => {
        comment.forEach(item => {
            result.push(item);
        });
    });

    let scores = [];

    for (let i = 0; i < result.length; i++) {
        let item = result[i];
        await util.getNegativeWords(item.detail).then(obj => {
            obj.text = item.detail;
            obj.item_id = item.item_id;
            obj.comment_id = item.order_item_id;
            scores.push(obj);
            console.log(obj);
        })
        console.log('第' + i + '条数据读取完毕\n');
    }
    return scores;
}

module.exports = {
    getGoodsList,
    getDetail,
    getComment,
    splitComment,
    getCommentScore,

    //  评论信息增量备份 
    handleComment
};