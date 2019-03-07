const fs = require('fs');
const csv = require('fast-csv');
const prompt = require('prompt');
const Nightmare = require('nightmare');

const maxProcessTry = 3;

let nightmare;

let email, password, version, showNightmare, searchInterval;

let data = [];
let connections = [];
let connectionsToProcess = 0;

let index = 0;

// Setup prompt attributes
let prompt_attrs = [
    {
        name: 'version',
        default: 'new',
        message: 'What UI Version do you have? (old/new)'
    },
    {
        name: 'email',
        required: true,
        message: 'LinkedIn email'
    },
    {
        name: 'password',
        hidden: true,
        required: true,
        message: 'LinkedIn password'
    },
    {
        name: 'searchInterval',
        default: '2000',
        message: 'Wait interval between each connection search (in ms)'
    },
    {
        name: 'showNightmare',
        default: 'no',
        message: 'Show email extraction process? (yes/no)'
    }
];

// Get connection names from connections.csv
let stream = fs.createReadStream('Connections.csv');
csv.fromStream(stream, { headers: true })
    .on('data', function(d) {
        connections.push(`${d['First Name']} ${d['Last Name']}`);
    })
    .on('end', function() {
        // Setup data processing
        extractedDataProcedure();
        console.log(`Total connections to extract: ${connectionsToProcess} / ${data.length}`);
        start();
    });

// This function starts the process by asking user for LinkedIn credentials, as well config options
// - email & password are used to log in to linkedin
function start() {
    if (connectionsToProcess <= 0) {
        console.log('No connections to extract or they have all been extracted already.');
    } else {
        prompt.start();

        prompt.get(prompt_attrs, (err, result) => {
            email = result.email;
            password = result.password;
            version = result.version;
            showNightmare = result.showNightmare === 'yes';
            searchInterval = parseInt(result.searchInterval);
            nightmare = Nightmare({
                show: showNightmare,
                waitTimeout: 20000
            });
            getEmails(index);
        });
    }
}

// Emails are stored in this array to be written to email.txt later.

// Initial email extraction procedure
// Logs in to linked in and runs the getEmail async function to actually extract the emails
async function getEmails(index) {
    try {
        await nightmare
            .goto('https://linkedin.com')
            .insert('#login-email', email)
            .insert('#login-password', password)
            .click('#login-submit')
            .wait('.nav-item--mynetwork')
            .run(() => {
                getEmail(index);
            });
    } catch (e) {
        console.error('An error occured while attempting to login to linkedin.');
    }
}

// Actual email extraction procedure
// Crawler looks for seach input box, writes connection name, clicks on first result, and copies connection's email
async function getEmail(index) {
    if (index < data.length) {
        if (data[index].email) {
            console.log(`#${index} ${data[index].name} email ${data[index].email} already extracted`);
        } else if (data[index].processed_count >= maxProcessTry) {
            console.log(`#${index} ${data[index].name} failed to extract email ${data[index].processed_count} times`);
        } else {
            data[index].processed_count += 1;
            try {
                await nightmare
                    .wait('.nav-item--mynetwork')
                    .click('.nav-item--mynetwork a')
                    .wait(`${version ? '.mn-community-summary__link' : '.js-mn-origami-rail-card__connection-count'}`)
                    .click(`${version ? '.mn-community-summary__link' : '.js-mn-origami-rail-card__connection-count'}`)
                    .wait('.mn-connections__search-input')
                    .wait(searchInterval)
                    .insert('.mn-connections__search-input', data[index].name)
                    .wait(2000)
                    .click('.mn-connection-card__link')
                    .wait('.pv-top-card-v2-section__link--contact-info')
                    .click('.pv-top-card-v2-section__link--contact-info')
                    .wait('.pv-contact-info.artdeco-container-card');

                // here we get the email from the connections linkedin page.
                data[index].email = await nightmare.evaluate(() => {
                    try {
                        return document
                            .querySelector('.pv-contact-info__contact-type.ci-email a.pv-contact-info__contact-link')
                            .href.replace('mailto:', '');
                    } catch (e) {
                        console.error(`#${index} ${data[index].name} email could not be extracted`);
                    }
                });
                console.log(`#${index} ${data[index].name} email ${data[index].email} freshly extracted`);
            } catch (e) {
                console.error(`#${index} ${data[index].name} unable to extract email`);
            }
        }
        saveExtractedData();
        saveEmailsFile();
    } else {
        // When all emails have been extracted, end nightmare crawler
        await nightmare.end();
        return;
    }
    getEmail(index + 1);
}

function extractedDataProcedure() {
    if (fs.existsSync('stored_data/extracted_data.json')) {
        data = JSON.parse(fs.readFileSync('stored_data/extracted_data.json', 'utf8'));
    } else if (!fs.existsSync('stored_data')) {
        fs.mkdirSync('stored_data');
        data = [];
    }

    for (let c = 0; c < connections.length; c++) {
        let cname = connections[c];
        let ent = data.find(u => u.name == cname);
        if (!ent) {
            data.push({
                name: cname,
                email: null,
                processed_count: 0
            });
        }
    }

    for (let c = 0; c < data.length; c++) {
        if (!data[c].email && data[c].processed_count < maxProcessTry) {
            connectionsToProcess += 1;
        }
    }
}

function saveEmailsFile() {
    let emails = '';
    for (let c = 0; c < data.length; c++) {
        if (data[c].email) {
            emails += c.email + '\n';
        }
    }
    fs.writeFile('stored_data/emails.txt', emails, function(err) {
        if (err) {
            console.error(err);
            throw err;
        }
    });
}

function saveExtractedData() {
    fs.writeFile('stored_data/extracted_data.json', JSON.stringify(data), function(err) {
        if (err) {
            console.error(err);
            throw err;
        }
    });
}
