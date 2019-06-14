const puppeteer = require('puppeteer');
const db = require('./db.json');
const fs = require('fs');
const OSS = require('ali-oss');
const oss_client = new OSS({
  region: process.env.OSS_REGION,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET
});
const Octokit = require('@octokit/rest');
const github_client = new Octokit({
  auth: process.env.GITHUB_TOKEN
});


(async () => {
  const browser = await puppeteer.launch({
    defaultViewport: {
      width: 1920,
      height: 1080
    },
    args: [
      '--proxy-server=127.0.0.1:1080'
    ]
  });

  const now = new Date();

  // build README.md content
  let content = `
  
 上次更新: ${now.toDateString()} ${now.toTimeString()} 

 > 仅显示一小时内更新的post, [更多...](screenshots/)
  `;

  // get labels from insshot repository
  let users = await github_client.issues.listLabelsForRepo({
    owner: 'jwenjian',
    repo: 'insshot'
  });

  
  console.log(users);

  // iterrate the users in db
  for (let i = 0; i < users.data.length; i++) {
    let curr_user = users.data[i].name;

    // each user have its own page
    const page = await browser.newPage();

    // open user profile page
    await page.goto('https://www.instagram.com/' + curr_user + '/', {
      timeout: 0,
      waitUntil: 'networkidle0'
    });

    await page.waitForSelector('article > div:nth-child(1) > div > div > div > a:nth-child(1)');

    // get first 24 post links
    let posts = await page.$$('article > div:nth-child(1) > div > div > div > a:nth-child(1)');

    // build user content in README.md
    let curr_user_content = `
# [${curr_user}](https://www.instagram.com/${curr_user}/)

最新:

    `;

    // only process first post for each user
    let first_post = posts[0];
    let href_handle = await first_post.getProperty('href')
    let href = await href_handle.jsonValue();

    // do screenshot
    let pngpath = 'screenshots/' + curr_user + '/latest.png';

    curr_user_content += `

![${curr_user}](${pngpath}?raw=true)

        `;

    // check if is the same one with last shot
    let saved_link = db['last_saved_link'][curr_user];
    if (saved_link && href === saved_link) {
      console.log(`${curr_user}  ${href} already saved, skip for current job`);
      continue;
    }

    // only show new post in last hour
    content += curr_user_content;

    // each post have its own page
    let new_page = await browser.newPage();
    await new_page.goto(href, {
      timeout: 0,
      waitUntil: 'networkidle0'
    });

    let article = await new_page.waitForSelector('article', {
      timeout: 0
    });

    // since we not logged in, instagram will display the latest comment on right side instead of owner's text, so we will do some trick
    // to scroll the right side to make owner's text scroll into the view.
    await new_page.evaluate(() => document.querySelector('article > div > div > ul > li').scrollIntoView());

    if (!fs.existsSync('screenshots/' + curr_user)) {
      fs.mkdirSync('screenshots/' + curr_user);
    }

    await article.screenshot({
      path: pngpath
    })
    console.log(pngpath);

    // save to ali oss
    await put(curr_user, 'latest', false);

    // save link to db
    db['last_saved_link'][curr_user] = href;

    await save_db(db);
  }

  // update README
  fs.writeFile('README.md', content, (err) => { });

  await browser.close();
})();

async function save_db(db_obj) {
  let db_str = JSON.stringify(db_obj, null, 2);
  fs.writeFileSync('db.json', db_str, err => {
    console.error('save db failed');
  })
}

async function put(username, filename, del_after_upload) {
  let filepath = 'screenshots/' + username + '/' + filename + '.png';

  try {
    let result = await oss_client.put(filepath, filepath);
    if (del_after_upload === true) {
      fs.unlink(filepath);
    }
  } catch (e) {
    console.error(e);
  }
}