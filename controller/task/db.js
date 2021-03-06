let settings = require('../../schema/config');
let fs = require('fs');
let util = require('../util/common');
let query = require('../../schema/mysql');
let sqlStr = require('../../schema/sql');

// 初始化数据库
async function initDbByName(name) {
    let fileName = util.getMainContent() + '/schema/sqlInit/' + name + '.sql';
    let sqlList = fs.readFileSync(fileName, 'utf-8');
    sqlList = sqlList.split(';');
    for (let i = 0; i < sqlList.length; i++) {
        let sql = sqlList[i].trim();
        if (sql.length) {
            console.log(sql);
            await query(sql);
        }
    }
}

async function dbInit() {
    // 此处crawler记录表单数据抓取状态
    let shopList = ['ccgold', 'wfx', 'yz', 'cncoin', 'crawler', 'sge', 'jd'];

    let sql = sqlStr.query.tbl_num;
    let data = await query(sql);
    let tblNum = {};

    data.forEach(item => {
        tblNum[item.shopName] = item.num;
    });

    // 各家网店表单数量
    let tblNumSettings = {
        ccgold: 1,
        cncoin: 13,
        crawler: 1,
        wfx: 5,
        yz: 3,
        sge: 1,
        jd: 4
    }

    // 此处四家店铺初始化语句中需删除导出语句的注释内容
    shopList.forEach((item, i) => {
        if (!Reflect.has(tblNum, item) || tblNum[item] < tblNumSettings[item]) {
            initDbByName(item);
            console.log(`${i+1}.数据库 ${item} 初始化完毕`);
        }
    })
}

async function init() {
    if (settings.needInit) {
        console.log('A.数据库初始化');
        console.log('1.数据库表单尚未初始化');
        await dbInit();
        console.log('2.表单初始化完毕\n');
    }
}

// 判断某一日的数据是否需要采集，用于库存、价格、销量等查询
async function needUpdate(tblName) {
    let sql = sqlStr.query.need_update.replace('?', tblName);
    let data = await query(sql);
    return (data.length == 0) ? 1 : data[0].need_update;
}

async function setCrawlerStatus(tblName) {
    let sql = sqlStr.insert.crawler_list.replace('?', tblName);
    await query(sql);
}

module.exports = {
    init,
    needUpdate,
    setCrawlerStatus
};