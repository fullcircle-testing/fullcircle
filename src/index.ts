import {initApp} from './express_app';

const app = initApp();

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`http://localhost:${port}`);
});
