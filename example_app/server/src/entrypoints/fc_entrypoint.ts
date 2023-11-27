import {initApp} from '../server';
import {ExampleAppDependencies} from '../types';

const FULLCIRCLE_HOST = process.env.FULLCIRCLE_HOST;
if (!FULLCIRCLE_HOST) {
    console.error('Please provide the fullcircle server host via environment variable FULLCIRCLE_HOST');
    process.exit(1);
}

const deps: ExampleAppDependencies = {
    externalUrl: FULLCIRCLE_HOST,
};

const app = initApp(deps);

const port = process.env.PORT || 6000;
app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
