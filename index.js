import cheerio from 'cheerio';
import fs from 'fs';
import chunk from 'lodash/chunk.js';
import { checkPath, readFile, downloadFile } from './utils/fs.js';
import fetch from './utils/fetch.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function sequence(promises) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const result = [];

    function callBack() {
      if (promises.length === 0) {
        resolve();
      }
      return promises[i]().then((res) => {
        i += 1;
        result.push(res);
        if (i === promises.length) {
          resolve(result);
        }
        callBack();
      }).catch(reject);
    }

    return callBack();
  });
}

const baseUrl = 'https://www.manhuadb.com';

// 根据编号获取url地址
export async function getIndexUrl(number) {
  let url = `${baseUrl}/manhua/`;
  if (number) url += number;
  return url;
}

// 获取漫画基本信息和章节目录
export async function getData(url) {
  const html = await fetch(url).then(res => res.text());
  const $ = cheerio.load(html, { decodeEntities: false });

  //   获取title
  const title = await $('h1.comic-title').text();

  //   获取简介
  const description = await $('p.comic_story').text();

  //   获取creators
  const creators = [];
  function getCreators() {
    creators.push($(this).find('a').text());
  }
  await $('.creators').find('li').map(getCreators);

  //   获取卷
  const list = [];
  function getVlue() {
    const href = `${baseUrl}${$(this).find('a').attr('href')}`;
    list.push({
      href,
    });
  }
  await $('.active .links-of-books.num_div').find('li.sort_div').map(getVlue);

  //  获取数据
  const data = [];
  function getComicData() {
    const key = $(this).find('td').attr('class') || $(this).find('td a').attr('class');
    const value = key === 'comic-cover' ? $(this).find('td img').attr('src') : $(this).find('td').text();
    const label = $(this).find('th').text();
    data.push({
      key,
      label,
      value,
    });
  }
  await $('.table.table-striped.comic-meta-data-table').find('tr').map(getComicData);

  const detail = await $('article.comic-detail-section').html();

  return {
    title,
    creators,
    description,
    list,
    data,
    detail,
  };
}

// 获取章节内全部页
export async function getPageList(url) {
  const html = await fetch(url).then(res => res.text());
  const $ = cheerio.load(html, { decodeEntities: false });
  const list = [];
  function getPage2(num) {
    if (!num) return;
    for (let i = 1; i <= num; i++) {
      const urlArr = url.split('.');
      urlArr[urlArr.length - 2] += `_p${i}`;
      list.push(urlArr.join('.'));
    }
  }
  let pageNumDom = await $('.c_nav_page');
  let pageNum = pageNumDom[0].nextSibling.data.split(' ')[2];
  getPage2(pageNum);
  return list;
}

// 获取页内图片地址
export async function getPage(url) {
  const html = await fetch(url).then(res => res.text());
  const $ = cheerio.load(html, { decodeEntities: false });
  const imgs = await $('img.img-fluid.show-pic');
  const src = imgs[0]?.attribs?.src
  return `${src}`;
}

async function test(number) {
  const indexUrl = await getIndexUrl(number);
  const data = await getData(indexUrl);

  const promiseList = data.list.map((i, idx) => async () => {
    let pageList = await getPageList(i.href);

    const imgs = [];
    const cur = 20;

    let promiseList = chunk(pageList, cur).map((pages, pdx) => async () => {
      // 以20一组，并行访问
      await Promise.all(pages.map(async (j, jdx) => {
        await sleep(1000);
        let src = await getPage(j);
        imgs.push({
          index: pdx * cur + jdx,
          src
        });

        console.log(src);
      }));
    })

    // 分20一组，串行访问
    await sequence(promiseList);

    data.list[idx].list = imgs.sort((a, b) => a.index - b.index);
  });

  await sequence(promiseList);

  console.log('爬取成功！！！');

  fs.writeFileSync(`./jojo/${number}.json`, JSON.stringify(data));
}

// test(2093);

async function readJson() {
//   await checkPath('../jojo');
  const data = await readFile('./jojo/2093.json');
  const json = JSON.parse(data);

  const cur = 50;
  await sequence(json.list.map((list, idx) => async () => {
    const dirpath = `./jojo/${idx + 1}`;
    await checkPath(dirpath);
    await sequence(chunk(list.list, cur).map((pages, pdx) => async () => {
      await sleep(Math.random() * 1000);
      console.log('正在获取:', `/jojo/${idx + 1}/`, ` 第${pdx + 1}批`);
      await Promise.all(pages.map(async (j, jdx) => {
        const filepath = `./jojo/${idx + 1}/${cur * pdx + jdx + 1}.jpg`;
        async function race() {
          await sleep(Math.random() * 1000);
          const res = await Promise.race([
            downloadFile(j.src, filepath),
            sleep(60000),
          ]);
          if (res) {
            // console.log('下载成功');
          } else {
            console.log('重新加入队列');
            await race();
          }
        }
        await race();
      }));
    }));
  }));
  console.log('获取成功');
}

readJson();
